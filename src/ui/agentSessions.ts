/**
 * Agent chat sessions: multiple saved conversations you can switch between, persisted to
 * localStorage so they survive reloads. One session is "current"; its turns feed the
 * chat. A fresh session is titled from its first user message. Sessions are global (not
 * per-project) for now - the agent re-reads project state via list_tracks each turn, so a
 * conversation can span projects; per-project scoping is a possible follow-on.
 */
import { useCallback, useEffect, useState } from "react";
import type { ChatTurn } from "./useAgentChat";

const KEY = "web-daw:agent-sessions:v1";
const NEW_TITLE = "New chat";

export interface AgentSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

interface SessionState {
  sessions: AgentSession[];
  currentId: string;
}

/** A session's title derived from its first user message (or the placeholder). */
export function titleFrom(turns: ChatTurn[]): string {
  const firstUser = turns.find((turn) => turn.role === "user");
  const text = firstUser?.content.trim().replace(/\s+/g, " ") ?? "";
  if (!text) return NEW_TITLE;
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function blankSession(now: number): AgentSession {
  return { id: `s-${crypto.randomUUID().slice(0, 8)}`, title: NEW_TITLE, createdAt: now, updatedAt: now, turns: [] };
}

function load(): SessionState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionState;
      if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
        const currentId = parsed.sessions.some((session) => session.id === parsed.currentId)
          ? parsed.currentId
          : parsed.sessions[0].id;
        return { sessions: parsed.sessions, currentId };
      }
    }
  } catch {
    // Corrupt/absent - fall through to a fresh session.
  }
  const session = blankSession(0);
  return { sessions: [session], currentId: session.id };
}

export function useAgentSessions() {
  const [state, setState] = useState<SessionState>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage full or unavailable - keep working in-memory.
    }
  }, [state]);

  const current = state.sessions.find((session) => session.id === state.currentId) ?? state.sessions[0];

  const setTurns = useCallback((turns: ChatTurn[]) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((session) =>
        session.id === prev.currentId
          ? {
              ...session,
              turns,
              title: session.title === NEW_TITLE ? titleFrom(turns) : session.title,
              updatedAt: Date.now(),
            }
          : session,
      ),
    }));
  }, []);

  const newSession = useCallback(() => {
    setState((prev) => {
      const session = blankSession(Date.now());
      return { sessions: [session, ...prev.sessions], currentId: session.id };
    });
  }, []);

  const switchSession = useCallback((id: string) => setState((prev) => ({ ...prev, currentId: id })), []);

  const deleteSession = useCallback((id: string) => {
    setState((prev) => {
      const remaining = prev.sessions.filter((session) => session.id !== id);
      if (remaining.length === 0) {
        const session = blankSession(Date.now());
        return { sessions: [session], currentId: session.id };
      }
      const currentId = prev.currentId === id ? remaining[0].id : prev.currentId;
      return { sessions: remaining, currentId };
    });
  }, []);

  return {
    sessions: state.sessions,
    currentId: state.currentId,
    turns: current.turns,
    setTurns,
    newSession,
    switchSession,
    deleteSession,
  };
}
