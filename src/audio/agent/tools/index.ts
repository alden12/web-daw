/**
 * The agent's whole toolset - what it can do to a project - aggregated from the domain
 * modules. Read tools query the live `projectStore`; edit tools go through
 * `dispatch(command, "agent")`, the exact path the UI and MCP use, so the agent inherits
 * undo, the activity feed, history, and engine reconciliation for free. Argument sets
 * that reference instruments/effects/params validate against the catalogs (never a
 * hardcoded list). Adding a tool is one `defineTool` entry in the relevant module.
 *
 * Every tool takes/returns plain serializable data and returns a Promise, so a tool can
 * later be backed by a Worker actor without touching the loop. See docs/AGENT.md.
 */
import type { AgentTool } from "../types";
import { makeContext, type AgentToolDeps } from "./factory";
import { structureTools } from "./structure";
import { clipTools } from "./clips";
import { soundTools } from "./sound";
import { projectTools } from "./project";

export type { AgentToolDeps } from "./factory";

export function createAgentTools(deps: AgentToolDeps): AgentTool[] {
  const context = makeContext(deps);
  return [...structureTools(context), ...clipTools(context), ...soundTools(context), ...projectTools(context)];
}
