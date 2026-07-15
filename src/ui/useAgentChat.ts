/**
 * The reason-act loop for one user message, tracking ephemeral pending/error. The
 * conversation turns are owned by the caller (the session store), passed in with a
 * setter, so switching sessions swaps the history transparently. The loop seeds from the
 * visible turns; its own tool rounds stay internal, and each assistant turn records which
 * tools ran (for the activity chips). See docs/AGENT.md.
 */
import { useCallback, useMemo, useState } from "react";
import { createGeminiProvider, ProviderError } from "../audio/agent/geminiProvider";
import { runAgent } from "../audio/agent/loop";
import type { AgentProvider, AgentTool, ChatMessage } from "../audio/agent/types";

const SYSTEM_PROMPT = [
  "You are an AI collaborator embedded in a browser music DAW, working alongside the user.",
  "You can inspect and edit the project by calling the provided tools; prefer acting over just describing.",
  "Call list_tracks first to learn track ids, the tempo, and the instrument palette before editing.",
  "Times are in beats: 4 beats = 1 bar. Pitches are MIDI numbers, C4 = 60. Velocity is 0..1.",
  "Make small, purposeful edits, then briefly tell the user what you did.",
  "If a tool returns an error, read it and adjust - do not repeat the same failing call.",
].join(" ");

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  /** When the turn was created (epoch ms), for the timestamp. */
  at?: number;
  /** Tools the agent ran to produce this turn (assistant turns only). */
  activity?: { name: string; ok: boolean }[];
  /** Tokens the exchange cost (assistant turns only). */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatError {
  message: string;
  /** When a retry is allowed again (epoch ms), from a rate-limit cooldown. */
  retryAt?: number;
}

export function useAgentChat(
  tools: AgentTool[],
  turns: ChatTurn[],
  setTurns: (turns: ChatTurn[]) => void,
  provider?: AgentProvider,
) {
  const agent = useMemo(() => provider ?? createGeminiProvider(), [provider]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);

  // Run the loop over a conversation ending in the message to answer, appending the
  // assistant turn on success. Shared by send (new message) and retry (re-run the last).
  const run = useCallback(
    async (history: ChatTurn[]) => {
      setError(null);
      setPending(true);
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((turn): ChatMessage => ({ role: turn.role, content: turn.content })),
      ];
      try {
        const result = await runAgent({ messages, provider: agent, tools });
        setTurns([
          ...history,
          {
            role: "assistant",
            content: result.text,
            at: Date.now(),
            activity: result.invocations.map((invocation) => ({ name: invocation.name, ok: invocation.ok })),
            usage: result.usage,
          },
        ]);
      } catch (err) {
        setError(toChatError(err));
      } finally {
        setPending(false);
      }
    },
    [agent, tools, setTurns],
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

  return { pending, error, send, retry };
}

function toChatError(err: unknown): ChatError {
  const message = err instanceof Error ? err.message : "Something went wrong talking to the agent.";
  const cooldown = err instanceof ProviderError ? err.retryAfterSeconds : undefined;
  return { message, retryAt: cooldown ? Date.now() + cooldown * 1000 : undefined };
}
