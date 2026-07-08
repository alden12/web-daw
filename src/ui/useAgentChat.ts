/**
 * Conversation state for the agent panel: holds the visible turns, sends the running
 * history to the provider, and tracks pending/error. Kept apart from the panel so the
 * view stays declarative and the send logic is easy to reason about. Tools and the full
 * reason-act loop layer on top of this later (see docs/AGENT.md); for now it is a plain
 * request/response chat.
 */
import { useCallback, useMemo, useState } from "react";
import { createGeminiProvider } from "../audio/agent/geminiProvider";
import type { AgentProvider, ChatMessage } from "../audio/agent/types";

const SYSTEM_PROMPT =
  "You are an AI collaborator embedded in a browser music DAW. Be concise and practical. " +
  "You cannot edit the project yet - that capability is coming - so for now help the user " +
  "think through arrangement, sound design, mixing, and music theory.";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function useAgentChat(provider?: AgentProvider) {
  const agent = useMemo(() => provider ?? createGeminiProvider(), [provider]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Depends on `turns`, so each render binds send() to the current history - no ref.
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
        const reply = await agent.chat(messages);
        setTurns((prev) => [...prev, { role: "assistant", content: reply.text }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong talking to the agent.");
      } finally {
        setPending(false);
      }
    },
    [agent, pending, turns],
  );

  return { turns, pending, error, send };
}
