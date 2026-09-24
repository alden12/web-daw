/** MCP tools: Groups (bus tree). */
import { z } from "zod";
import { makeGroupId, ok, fail } from "../shared";
import type { ToolContext } from "../context";

export function registerGroupsTools({ server, target, trackArg, resolveTrack, resolveGroup }: ToolContext): void {
  server.registerTool(
    "list_groups",
    {
      title: "List groups",
      description:
        "List the project's groups (bus tree): id, name, parent (null = top-level/master), mute, volume, collapsed, effect count, and the tracks filed in each.",
    },
    async () =>
      ok(
        JSON.stringify(
          {
            groups: target.project.getGroups().map((g) => ({
              id: g.id,
              name: g.name,
              parent: g.parentId,
              muted: g.muted,
              solo: g.solo,
              volume: g.volume,
              collapsed: g.collapsed,
              effects: g.effects.length,
              tracks: target.project
                .getTracks()
                .filter((t) => t.parentId === g.id)
                .map((t) => t.id),
            })),
          },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    "create_group",
    {
      title: "Create group",
      description:
        "Create a group (bus). Nest it under `parent`, or omit for a top-level group routed to master. Returns the new group id.",
      inputSchema: {
        name: z.string().optional(),
        parent: z.string().optional().describe("parent group id; omit for top-level"),
      },
    },
    async ({ name, parent }) => {
      if (!target.connected()) return fail("No DAW tab connected.");
      if (parent !== undefined && "error" in resolveGroup(parent)) {
        return fail(`Unknown parent group "${parent}". Use list_groups.`);
      }
      const id = makeGroupId();
      const parentId = parent ?? null;
      target.send({ type: "createGroup", id, name, parentId });
      target.project.addGroup({ id, name, parentId });
      return ok(`Created group "${target.project.getGroup(id)?.name}" (id ${id}).`);
    },
  );

  server.registerTool(
    "remove_group",
    {
      title: "Remove group",
      description:
        "Remove a group AND everything inside it (its tracks, their clips, and any subgroups). Move tracks out first to keep them.",
      inputSchema: { group: z.string() },
    },
    async ({ group }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "removeGroup", groupId: r.id })) return fail("No DAW tab connected.");
      target.project.removeGroup(r.id);
      return ok(`Removed group ${r.id} and its contents.`);
    },
  );

  server.registerTool(
    "set_group",
    {
      title: "Set group",
      description:
        "Set a group's name, mute, solo, volume (0..1), and/or collapsed state. Muting a group silences everything routed through it.",
      inputSchema: {
        group: z.string(),
        name: z.string().optional(),
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        volume: z.number().min(0).max(1).optional(),
        collapsed: z.boolean().optional(),
      },
    },
    async ({ group, name, muted, solo, volume, collapsed }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (!target.send({ type: "setGroup", groupId: r.id, name, muted, solo, volume, collapsed }))
        return fail("No DAW tab connected.");
      if (name !== undefined) target.project.renameGroup(r.id, name);
      if (muted !== undefined) target.project.setGroupMuted(r.id, muted);
      if (solo !== undefined) target.project.setGroupSolo(r.id, solo);
      if (volume !== undefined) target.project.setGroupVolume(r.id, volume);
      if (collapsed !== undefined) target.project.setGroupCollapsed(r.id, collapsed);
      return ok(`Updated group ${r.id}.`);
    },
  );

  server.registerTool(
    "move_track",
    {
      title: "Move track",
      description: "Move a track into another group.",
      inputSchema: { ...trackArg, group: z.string() },
    },
    async ({ track, group }) => {
      const r = resolveTrack(track);
      if ("error" in r) return fail(r.error);
      const g = resolveGroup(group);
      if ("error" in g) return fail(g.error);
      if (!target.send({ type: "moveTrack", trackId: r.id, groupId: g.id })) return fail("No DAW tab connected.");
      target.project.moveTrack(r.id, g.id);
      return ok(`Moved track ${r.id} into group ${g.id}.`);
    },
  );

  server.registerTool(
    "move_group",
    {
      title: "Move group",
      description: "Reparent a group under another group, or to top-level (omit `parent`). Rejects cycles.",
      inputSchema: {
        group: z.string(),
        parent: z.string().optional().describe("new parent group id; omit for top-level"),
      },
    },
    async ({ group, parent }) => {
      const r = resolveGroup(group);
      if ("error" in r) return fail(r.error);
      if (parent !== undefined && "error" in resolveGroup(parent))
        return fail(`Unknown parent group "${parent}". Use list_groups.`);
      const parentId = parent ?? null;
      if (!target.send({ type: "moveGroup", groupId: r.id, parentId })) return fail("No DAW tab connected.");
      target.project.moveGroup(r.id, parentId);
      return ok(`Moved group ${r.id} under ${parentId ?? "master"}.`);
    },
  );
}
