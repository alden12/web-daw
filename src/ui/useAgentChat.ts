/**
 * Conversation state for the agent panel: holds the visible turns and runs the
 * reason-act loop (which may call tools) for each user message, tracking pending/error.
 * Kept apart from the panel so the view stays declarative. The loop seeds from the
 * visible turns; its own tool rounds stay internal, and each assistant turn records
 * which tools ran (for the activity chips). See docs/AGENT.md.
 */
import { useCallback, useMemo, useState } from "react";
import { createGeminiProvider } from "../audio/agent/geminiProvider";
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
  /** Tools the agent ran to produce this turn (assistant turns only). */
  activity?: { name: string; ok: boolean }[];
}

export function useAgentChat(tools: AgentTool[], provider?: AgentProvider) {
  const agent = useMemo(() => provider ?? createGeminiProvider(), [provider]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || pending) return;
      setError(null);
      setPending(true);
      const history: ChatTurn[] = [...turns, { role: "user", content }];
      setTurns(history);
      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((turn): ChatMessage => ({ role: turn.role, content: turn.content })),
      ];
      try {
        const result = await runAgent({ messages, provider: agent, tools });
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.text,
            activity: result.invocations.map((invocation) => ({ name: invocation.name, ok: invocation.ok })),
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong talking to the agent.");
      } finally {
        setPending(false);
      }
    },
    [agent, pending, turns, tools],
  );

  return { turns, pending, error, send };
}
