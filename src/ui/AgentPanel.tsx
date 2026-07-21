/**
 * The agent panel (right): the in-app AI collaborator. It chats with the model (via the
 * user's own key, BYOK) and can inspect and edit the project by calling tools - the reason-act loop
 * runs its tools through the same `dispatch` the UI uses, so its edits show up live in
 * the arrangement and in the activity feed. Conversations are saved as switchable
 * sessions (persisted). See docs/AGENT.md. Collapsed by default, mounts only when
 * expanded; the expand control lives in the workbench tab bar.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgentChat } from "./useAgentChat";
import type { AgentStep } from "../audio/agent/loop";
import { useAgentSessions } from "./agentSessions";
import { createAgentTools } from "../audio/agent/tools";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Dispatch } from "../audio/commands/types";

// Markdown rendering (react-markdown + highlight.js) is a few hundred KB, and only
// assistant replies need it, so load it lazily - the panel shows the raw text first, then
// upgrades to rendered markdown once the chunk arrives (and stays cached after).
const Markdown = lazy(() => import("./Markdown").then((module) => ({ default: module.Markdown })));

/** HH:MM in local time, for a message timestamp. */
function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/** Compact token count: 340, 1.2k, 15k. */
function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
}

/** A tool's snake_case name as sentence case for display: `create_track` -> `Create track`. */
function humanizeToolName(name: string): string {
  const words = name.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A one-line description of the user's current selection, prepended to each turn so the
 *  agent knows what "this track"/"here"/"this clip" refer to without a tool call. */
function selectionContext(projectStore: ProjectStore): string {
  const id = projectStore.selectedId;
  const track = id ? projectStore.getTrack(id) : undefined;
  if (!track) return "Current selection: no track selected.";
  const instrument = track.kind === "instrument" ? `, ${track.instrumentType}` : "";
  const clip = track.clips.find((entry) => entry.id === track.activeClipId);
  const clipPart = clip ? `; active clip "${clip.name}" (id ${clip.id})` : "; no clip open";
  return (
    `Current selection: track "${track.name}" (id ${track.id}${instrument})${clipPart}. ` +
    `When the user says "this track", "here", "this clip" or similar, they mean this unless they say otherwise.`
  );
}

/**
 * The think-act-observe trail for an assistant turn: the act rounds the agent ran (its
 * narration + the tools each round called), plus a "stopped" marker when interrupted. It is
 * expanded while the run is live (`live`), then auto-collapses to a compact "N steps"
 * disclosure once the turn finishes, so old exchanges stay tidy but remain inspectable.
 */
function AgentTrail({ steps, stopped, live }: { steps?: AgentStep[]; stopped?: boolean; live: boolean }) {
  const [open, setOpen] = useState(live);
  // `open` follows `live` (expand while running, collapse when the run finishes) BUT the
  // disclosure button must also be able to toggle it independently and have that stick
  // afterward - so it is real state, not a value derived from `live`.
  //
  // To snap it on each live -> !live (or !live -> live) transition we use React's
  // "adjust state during render" pattern (react.dev, "You Might Not Need an Effect"):
  // `wasLive` tracks the previous `live` so the `if` fires exactly once, on the render where
  // `live` changed. Setting state *during* render makes React re-render synchronously and
  // discard this pass BEFORE the browser paints, so the collapse happens with no flash of the
  // wrong state. On the immediate re-render `wasLive === live`, so the `if` is false and it
  // settles (no infinite loop). Deliberately NOT a `useEffect` (that runs after paint -> a
  // visible wrong frame, plus a cascading-render lint smell) and `wasLive` is state, not a
  // ref: writing a ref during render is impure and misbehaves under StrictMode/concurrent
  // double-render, whereas a render-phase state update is rolled back cleanly.
  const [wasLive, setWasLive] = useState(live);
  if (live !== wasLive) {
    setWasLive(live);
    setOpen(live);
  }

  const hasSteps = steps !== undefined && steps.length > 0;
  if (!hasSteps && !stopped) return null;

  return (
    <div className="mb-1.5 flex flex-col gap-1">
      {hasSteps && !live && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="self-start flex items-center gap-1 font-mono text-[10px] text-faint hover:text-muted cursor-pointer"
        >
          <span className="text-[15px] leading-none w-4 text-center">{open ? "▾" : "▸"}</span>
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </button>
      )}
      {open && hasSteps && (
        <div className="flex flex-col gap-1.5">
          {steps.map((step, stepIndex) => (
            <div key={stepIndex} className="flex flex-col gap-1">
              {step.text && (
                <div className="text-[11px] text-muted whitespace-pre-wrap leading-relaxed">{step.text}</div>
              )}
              {step.activity.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {step.activity.map((tool, toolIndex) => (
                    <span
                      key={toolIndex}
                      className={`font-mono text-[9px] rounded px-1.5 py-0.5 border ${
                        tool.ok ? "border-you/40 text-you" : "border-warn/50 text-warn"
                      }`}
                    >
                      {tool.ok ? "✓" : "✕"} {humanizeToolName(tool.name)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {stopped && <span className="self-start font-mono text-[9px] text-faint">⏹ Stopped</span>}
    </div>
  );
}

export function AgentPanel({
  onCollapse,
  projectStore,
  dispatch,
  scheduler,
  hasApiKey,
  onOpenSettings,
}: {
  onCollapse: () => void;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  scheduler: Scheduler;
  /** Whether a BYOK key is set; drives the empty-state prompt to open Settings. */
  hasApiKey: boolean;
  onOpenSettings: () => void;
}) {
  const tools = useMemo(
    () => createAgentTools({ projectStore, dispatch, scheduler }),
    [projectStore, dispatch, scheduler],
  );
  const { sessions, currentId, turns, setTurns, newSession, switchSession, deleteSession } = useAgentSessions();
  const getContext = useCallback(() => selectionContext(projectStore), [projectStore]);
  const { pending, error, send, retry, stop } = useAgentChat(tools, turns, setTurns, { getContext });
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const currentTitle = sessions.find((session) => session.id === currentId)?.title ?? "New chat";

  // A failed message is a user turn with no assistant reply after it (only the last turn
  // can dangle); offer a retry on it.
  const lastTurn = turns[turns.length - 1];
  const canRetry = !pending && lastTurn?.role === "user";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending]);

  const submit = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    void send(text);
  };

  return (
    <div className="[grid-area:agent] bg-panel border-l border-line flex flex-col min-w-0 overflow-hidden">
      <div className="relative flex items-center gap-2 h-11 px-3 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-agent shrink-0" />
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Switch chat session"
          title="Switch chat session"
          className="min-w-0 flex items-center gap-1 cursor-pointer text-[13px] font-semibold text-bright hover:text-white"
        >
          <span className="truncate">{currentTitle}</span>
          <span className="shrink-0 text-[15px] leading-none text-muted">▾</span>
        </button>
        <button
          type="button"
          onClick={() => {
            newSession();
            setDraft("");
            setMenuOpen(false);
          }}
          aria-label="New chat"
          title="New chat"
          className="ml-auto shrink-0 text-[16px] leading-none text-muted hover:text-ink cursor-pointer px-1"
        >
          +
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse agent panel"
          title="Collapse agent panel"
          className="shrink-0 text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
        >
          »
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-3 top-11 z-30 w-64 max-h-80 overflow-y-auto rounded-md border border-line bg-card shadow-lg py-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => {
                    switchSession(session.id);
                    setMenuOpen(false);
                  }}
                  className={`group flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-ground ${
                    session.id === currentId ? "text-bright" : "text-muted"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-agent" />
                  <span className="flex-1 truncate text-[12px]">{session.title}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSession(session.id);
                    }}
                    aria-label={`Delete chat: ${session.title}`}
                    title="Delete chat"
                    className="shrink-0 text-[13px] leading-none text-faint hover:text-warn opacity-0 group-hover:opacity-100 cursor-pointer px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4">
        {turns.length === 0 && !pending && !hasApiKey && (
          <div className="m-auto max-w-[16rem] text-center flex flex-col items-center gap-2.5">
            <p className="text-faint font-mono text-[11.5px] leading-relaxed">
              Add your own API key to start chatting - it stays in this browser.
            </p>
            <button
              type="button"
              onClick={onOpenSettings}
              className="rounded-md border border-agent/55 bg-agent/15 px-3 py-1.5 text-[12px] text-bright hover:bg-agent/25 cursor-pointer"
            >
              Open settings
            </button>
          </div>
        )}
        {turns.length === 0 && !pending && hasApiKey && (
          <p className="m-auto max-w-[16rem] text-center text-faint font-mono text-[11.5px] leading-relaxed">
            Ask the agent to inspect or change your project - create tracks, write notes, add effects, tweak the mix.
          </p>
        )}
        {turns.map((turn, index) => (
          <div key={index} className={`w-full border-l-2 pl-3 ${turn.role === "user" ? "border-you" : "border-agent"}`}>
            <div className="mb-1 flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider">
              <span className={turn.role === "user" ? "text-you" : "text-agent"}>
                {turn.role === "user" ? "You" : "Agent"}
              </span>
              <span className="ml-auto flex items-center gap-1.5 normal-case tracking-normal text-faint">
                {turn.usage && turn.usage.inputTokens + turn.usage.outputTokens > 0 && (
                  <span title="tokens in / out">
                    {formatTokens(turn.usage.inputTokens)}/{formatTokens(turn.usage.outputTokens)}
                  </span>
                )}
                {turn.at !== undefined && <span>{formatClock(turn.at)}</span>}
              </span>
            </div>
            <AgentTrail steps={turn.steps} stopped={turn.stopped} live={pending && index === turns.length - 1} />
            {turn.content &&
              (turn.role === "user" ? (
                <div className="text-[12.5px] text-ink whitespace-pre-wrap leading-relaxed">{turn.content}</div>
              ) : (
                <Suspense
                  fallback={
                    <div className="text-[12.5px] text-ink whitespace-pre-wrap leading-relaxed">{turn.content}</div>
                  }
                >
                  <Markdown>{turn.content}</Markdown>
                </Suspense>
              ))}
            {index === turns.length - 1 && canRetry && (
              <button
                type="button"
                onClick={retry}
                title="Retry this message"
                className="mt-1.5 font-mono text-[10px] rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink hover:border-agent/55 cursor-pointer"
              >
                ↻ Retry
              </button>
            )}
          </div>
        ))}
        {pending && <div className="self-start font-mono text-[11px] text-faint">Agent is thinking...</div>}
      </div>

      {error && (
        <div className="mx-4 mb-2 shrink-0 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {error.message}
        </div>
      )}

      <div className="shrink-0 border-t border-line p-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Message the agent"
          aria-label="Message the agent"
          className="flex-1 min-w-0 resize-none rounded-md bg-ground border border-line px-2.5 py-2 text-[12.5px] text-ink placeholder:text-faint focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-1"
        />
        {pending ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop the agent"
            title="Stop the agent"
            className="shrink-0 rounded-md border border-warn/45 bg-warn/10 px-3 py-2 text-[12px] text-warn hover:bg-warn/20 cursor-pointer"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={draft.trim() === ""}
            className="shrink-0 rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink hover:border-agent/55 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
