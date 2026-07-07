/**
 * The agent panel (right): reserved space for the in-app AI agent. Activity,
 * versions, undo/redo, and the MCP status that used to live here moved to the
 * toolbar-less panel header and the left Activity view; what remains holds the
 * column and the agreed "agent-right" direction until the chat itself lands (a
 * follow-on). It is collapsed by default and mounts only when expanded - the
 * expand control lives in the workbench tab bar, so there is no idle rail.
 */
export function AgentPanel({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div className="[grid-area:agent] bg-panel border-l border-line flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center gap-2 h-11 px-4 border-b border-line shrink-0">
        <span className="w-2 h-2 rounded-full bg-claude" />
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
      <div className="flex-1 min-h-0 flex items-center justify-center p-6 text-center">
        <p className="text-faint font-mono text-[11.5px] leading-relaxed">
          An in-app AI collaborator will live here.
          <br />
          For now, drive the session from Claude Code over MCP.
        </p>
      </div>
    </div>
  );
}
