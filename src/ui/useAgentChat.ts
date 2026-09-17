/**
 * The reason-act loop for one user message, tracking ephemeral pending/error. The
 * conversation turns are owned by the caller (the session store), passed in with a
 * setter, so switching sessions swaps the history transparently. The loop seeds from the
 * visible turns; each assistant turn records the act rounds it ran (`steps`, the
 * think-act-observe trail) as they happen, so the panel grows the trail live. A run is
 * interruptible: `stop()` aborts the in-flight request and keeps the partial trail. See
 * docs/AGENT.md.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { createProvider } from "../audio/agent/provider";
import { runAgent, type AgentStep } from "../audio/agent/loop";
import type { AgentProvider, AgentTool, ChatMessage } from "../audio/agent/types";

const SYSTEM_PROMPT = [
  "You are an AI collaborator embedded in a browser music DAW, working alongside the user.",
  "You can inspect and edit the project by calling the provided tools; prefer acting over just describing.",
  "Call list_tracks first to learn track ids, the tempo, and the instrument palette before editing.",
  "Times are in beats: 4 beats = 1 bar. Pitches are MIDI numbers, C4 = 60. Velocity is 0..1.",
  "A drum kit maps each pad to a specific MIDI note. It follows the General MIDI drum map by default " +
    "(kick=36, snare=38, closed hat=42, open hat=46, ...), but pads can be remapped and custom samples may differ, " +
    "so call list_parameters on that track and use the `pads` map (each pad's note + sound) to pick pitches.",
  "Make small, purposeful edits by calling the matching tool, then briefly confirm what changed.",
  "Never say you have added, changed, removed, or created something unless you actually called its " +
    "tool in this same turn and saw it succeed. Do not describe an edit in the past tense before doing " +
    "it, and do not end your turn with a promise to act - if you intend to make a change, call the tool now.",
  "If a tool returns an error, read it and adjust - do not repeat the same failing call.",
].join(" ");

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** When the turn was created (epoch ms), for the timestamp. */
  at?: number;
  /** The act rounds the agent ran to produce this turn, in order (assistant turns only). */
  steps?: AgentStep[];
  /** True when the run was interrupted by the user before finishing (assistant turns only). */
  stopped?: boolean;
  /** Tokens the exchange cost (assistant turns only). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatError {
  message: string;
  /** The raw model/provider response that failed, when available - shown on demand in the
   *  error box so you can see exactly what came back. */
  details?: string;
}

export function useAgentChat(
  tools: AgentTool[],
  turns: ChatTurn[],
  setTurns: (turns: ChatTurn[]) => void,
  options?: {
    /** Override the default (BYOK) provider - used by tests. */
    provider?: AgentProvider;
    /** A fresh per-turn context line (e.g. the current selection) prepended to the prompt. */
    getContext?: () => string;
  },
) {
  const { provider, getContext } = options ?? {};
  const agent = useMemo(() => provider ?? createProvider(), [provider]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Run the loop over a conversation ending in the message to answer, appending the
  // assistant turn on success. Shared by send (new message) and retry (re-run the last).
  const run = useCallback(
    async (history: ChatTurn[]) => {
      setError(null);
      setPending(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const startedAt = Date.now();
      const context = getContext?.();
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...(context ? [{ role: "system" as const, content: context }] : []),
        ...history.map((turn): ChatMessage => ({ role: turn.role, content: turn.content })),
      ];
      // Per-run accumulator: steps arrive in order via onStep, so we grow a draft
      // assistant turn and re-publish it as the trail unfolds.
      const liveSteps: AgentStep[] = [];
      try {
        const result = await runAgent({
          messages,
          provider: agent,
          tools,
          signal: controller.signal,
          // Grow the trail live: each completed act round appends to a draft assistant turn.
          onStep: (step) => {
            liveSteps[step.index] = { text: step.text, activity: step.activity };
            setTurns([...history, { role: "assistant", content: "", at: startedAt, steps: [...liveSteps] }]);
          },
        });
        setTurns([
          ...history,
          {
            role: "assistant",
            content: result.text,
            at: startedAt,
            steps: result.steps,
            stopped: result.stopped,
            usage: result.usage,
          },
        ]);
      } catch (err) {
        setError(toChatError(err));
        setTurns(history);
      } finally {
        setPending(false);
        abortRef.current = null;
      }
    },
    [agent, tools, setTurns, getContext],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      const history: ChatTurn[] = [...turns, { role: "user", content, at: Date.now() }];
      setTurns(history);
      void run(history);
    },
    [pending, turns, setTurns, run],
  );

  // Re-answer the last (failed) user message, without adding a new one.
  const retry = useCallback(() => {
    if (pending || turns.length === 0 || turns[turns.length - 1].role !== "user") return;
    void run(turns);
  }, [pending, turns, run]);

  // Interrupt the in-flight run; runAgent resolves with the partial trail (stopped: true),
  // so the success path records what was done rather than surfacing an error.
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { pending, error, send, retry, stop };
}

function toChatError(err: unknown): ChatError {
  const message = err instanceof Error ? err.message : "Something went wrong talking to the agent.";
  // Provider/parse errors (ProviderError, ModelResponseError, EmptyReplyError) carry the raw
  // response body on `raw`; surface it as details so the error box can reveal it on demand.
  const raw = err && typeof err === "object" && "raw" in err ? (err as { raw?: unknown }).raw : undefined;
  return { message, ...(typeof raw === "string" && raw.length > 0 ? { details: raw } : {}) };
}
