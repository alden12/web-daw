/**
 * The agent pane (right): a first-class home for the AI collaborator. For now it
 * surfaces the MCP connection (the session is driven from Claude Code over MCP)
 * and scaffolds the activity feed. The in-app chat and the live edit history
 * land with the event-log slice; this establishes the region and the
 * collapse-to-rail behavior (Produce mode).
 */
import type { McpStatus } from '../audio/mcp/bridge';
import type { EditLog } from '../audio/commands/editLog';
import { useEditLog } from '../audio/commands/useEditLog';
import { describeCommand } from '../audio/commands/describe';

const DOT: Record<McpStatus, string> = {
  connected: 'bg-good',
  connecting: 'bg-warn',
  disconnected: 'bg-claude',
};

export function AgentPanel({ mcpStatus, editLog }: { mcpStatus: McpStatus; editLog: EditLog }) {
  const { entries } = useEditLog(editLog);
  const recent = entries.slice(-100).reverse();
  return (
    <div className="[grid-area:agent] bg-panel border-l border-line flex flex-col min-w-0 overflow-hidden">
      <div className="agent-full flex flex-col h-full">
        <div className="flex items-center justify-between h-12 px-4 border-b border-line">
          <span className="text-[12.5px] font-semibold text-bright">Agent</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted">
            <span className={`w-2 h-2 rounded-full ${DOT[mcpStatus]}`} /> {mcpStatus}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3.5">
          <p className="text-[12.5px] text-muted leading-relaxed">
            Drive the session from Claude Code over MCP - create tracks, set parameters, add effects, and play. An
            in-app chat lands in a later slice.
          </p>
          <div>
            <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint mb-2.5">Activity</div>
            {recent.length === 0 ? (
              <div className="border border-dashed border-line rounded-lg p-4 text-faint font-mono text-[11.5px] text-center">
                Edits you and Claude make appear here.
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {recent.map((entry) => (
                  <li
                    key={entry.seq}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-card/60 border-l-2 ${
                      entry.author === 'claude' ? 'border-claude' : 'border-you'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.author === 'claude' ? 'bg-claude' : 'bg-you'}`}
                    />
                    <span className="font-mono text-[11.5px] text-ink truncate">{describeCommand(entry.command)}</span>
                    <span className="ml-auto font-mono text-[10px] text-faint shrink-0">{entry.author}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <div className="agent-rail flex-col items-center gap-3.5 py-3.5" aria-hidden="true">
        <span className="w-2 h-2 rounded-full bg-claude" />
        <span className="w-2 h-2 rounded-full bg-you" />
      </div>
    </div>
  );
}
