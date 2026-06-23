/**
 * The agent pane (right): a first-class home for the AI collaborator. For now it
 * surfaces the MCP connection (the session is driven from Claude Code over MCP)
 * and scaffolds the activity feed. The in-app chat and the live edit history
 * land with the event-log slice; this establishes the region and the
 * collapse-to-rail behavior (Produce mode).
 */
import type { McpStatus } from '../audio/mcp/bridge';

const DOT: Record<McpStatus, string> = {
  connected: 'bg-good',
  connecting: 'bg-warn',
  disconnected: 'bg-claude',
};

export function AgentPanel({ mcpStatus }: { mcpStatus: McpStatus }) {
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
            <div className="border border-dashed border-line rounded-lg p-4 text-faint font-mono text-[11.5px] text-center">
              Edit history appears here once the event log lands.
            </div>
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
