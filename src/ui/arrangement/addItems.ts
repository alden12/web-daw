/**
 * What you can add to an arrangement, as menu rows: a group, or a MIDI or audio track in a group
 * of your choosing (or a fresh one). Built from the project's groups and `dispatch` alone, so both
 * shells call it directly: the desktop toolbar's "+" and the touch top bar's "+" (MOBILE-19.4).
 */
import type { Dispatch } from "../../audio/commands/types";
import type { GroupMeta } from "../../audio/project/types";
import { newGroupId, newTrackId } from "../../audio/commands/ids";
import { EMPTY_INSTRUMENT } from "../../audio/instruments/catalog";
import type { MenuItem } from "../Menu";

export function arrangementAddItems(groups: Pick<GroupMeta, "id" | "name">[], dispatch: Dispatch): MenuItem[] {
  // One entry per group plus a fresh group; the caller says how to make the track in it.
  const inGroup = (createTrack: (groupId: string) => void): MenuItem[] => [
    ...groups.map((group) => ({ label: group.name, onClick: () => createTrack(group.id) })),
    {
      label: "New group",
      onClick: () => {
        const groupId = newGroupId();
        dispatch({ type: "createGroup", id: groupId });
        createTrack(groupId);
      },
    },
  ];
  return [
    { label: "Add group", onClick: () => dispatch({ type: "createGroup", id: newGroupId() }) },
    // Every track lives in a group, so adding one picks the destination group (or a fresh group).
    // Nested as submenus so the menu stays short.
    {
      label: "New MIDI track in",
      submenu: inGroup((groupId) =>
        dispatch({ type: "createTrack", instrumentType: EMPTY_INSTRUMENT, id: newTrackId(), groupId }),
      ),
    },
    {
      label: "New audio track in",
      submenu: inGroup((groupId) => dispatch({ type: "createAudioTrack", id: newTrackId(), groupId })),
    },
  ];
}
