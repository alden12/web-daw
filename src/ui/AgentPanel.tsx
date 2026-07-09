/**
 * The agent panel (right): the in-app AI collaborator. It chats with the model (via the
 * key-proxy) and can inspect and edit the session by calling tools - the reason-act loop
 * runs its tools through the same `dispatch` the UI uses, so its edits show up live in
 * the arrangement and in the activity feed. See docs/AGENT.md. Collapsed by default,
 * mounts only when expanded; the expand control lives in the workbench tab bar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentChat } from "./useAgentChat";
import { createAgentTools } from "../audio/agent/tools";
import type { ProjectStore } from "../audio/project/projectStore";
import type { Scheduler } from "../audio/sequencer/scheduler";
import type { Dispatch } from "../audio/commands/types";

export function AgentPanel({
  onCollapse,
  projectStore,
  dispatch,
  scheduler,
}: {
  onCollapse: () => void;
  projectStore: ProjectStore;
  dispatch: Dispatch;
  scheduler: Scheduler;
}) {
  const tools = useMemo(
    () => createAgentTools({ projectStore, dispatch, scheduler }),
    [projectStore, dispatch, scheduler],
  );
  const { turns, pending, error, send } = useAgentChat(tools);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
      <div className="flex items-center gap-2 h-11 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-agent" />
        <span className="font-semibold text-[13px] text-bright">Agent</span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse agent panel"
          title="Collapse agent panel"
          className="ml-auto text-lg leading-none text-muted hover:text-ink cursor-pointer px-1"
        >
          »
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 p-4">
        {turns.length === 0 && !pending && (
          <p className="m-auto max-w-[16rem] text-center text-faint font-mono text-[11.5px] leading-relaxed">
            Ask the agent about your track. It can chat for now; giving it hands to edit the session comes next.
          </p>
        )}
        {turns.map((turn, index) => (
          <div
            key={index}
            className={
              turn.role === "user"
                ? "self-end max-w-[85%] rounded-lg border border-you/40 bg-you/10 px-3 py-2"
                : "self-start max-w-[85%] rounded-lg border border-line bg-card px-3 py-2"
            }
          >
            <div
              className={`mb-0.5 font-mono text-[9px] uppercase tracking-wider ${
                turn.role === "user" ? "text-you" : "text-agent"
              }`}
            >
              {turn.role === "user" ? "You" : "Agent"}
            </div>
            {turn.activity && turn.activity.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {turn.activity.map((step, stepIndex) => (
                  <span
                    key={stepIndex}
                    className={`font-mono text-[9px] rounded px-1.5 py-0.5 border ${
                      step.ok ? "border-you/40 text-you" : "border-warn/50 text-warn"
                    }`}
                  >
                    {step.ok ? "✓" : "✕"} {step.name}
                  </span>
                ))}
              </div>
            )}
            {turn.content && (
              <div className="text-[12.5px] text-ink whitespace-pre-wrap leading-relaxed">{turn.content}</div>
            )}
          </div>
        ))}
        {pending && <div className="self-start font-mono text-[11px] text-faint">Agent is thinking...</div>}
      </div>

      {error && (
        <div className="mx-4 mb-2 shrink-0 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          {error}
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
        <button
          type="button"
          onClick={submit}
          disabled={pending || draft.trim() === ""}
          className="shrink-0 rounded-md border border-line bg-card px-3 py-2 text-[12px] text-ink hover:border-agent/55 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Send
        </button>
      </div>
    </div>
  );
}
