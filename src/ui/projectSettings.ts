/**
 * Count-in and groove as menu rows (MOBILE-11).
 *
 * They are properties of the **project**, not of the arrangement surface: they read and write
 * project state, they change what recording and playback do everywhere, and nothing about them
 * is about the lane you are looking at. They lived in the timeline's toolbar menu only because
 * that is where the toolbar was - which was invisible until the touch shell started grouping a
 * menu by surface and put them under a heading that said "Arrangement".
 *
 * So they are built here instead, and both menus that want them ask for them: the timeline's
 * own kebab on desktop (where the toolbar is still their home) and the shell's project group on
 * touch. The count-in preference itself is a shared persisted value, so the two stay in step
 * without either owning the other.
 */
import { usePersistentNumber } from "./usePersistent";
import { GROOVES } from "../audio/grooves/catalog";
import type { MenuItem } from "./Menu";
import type { Dispatch } from "../audio/commands/types";
import type { ProjectStructure } from "../audio/project/projectStore";

/** Bars of count-in before a take starts. Persisted, and pushed to the recorder by the timeline. */
export const useCountInBars = () => usePersistentNumber("web-daw:count-in-bars", 1, 0, 2);

const COUNT_IN_CHOICES = [
  { bars: 0, label: "No count-in" },
  { bars: 1, label: "1 bar" },
  { bars: 2, label: "2 bars" },
];

const GROOVE_AMOUNTS = [0.25, 0.5, 0.75, 1];

export function useProjectSettingItems(project: ProjectStructure, dispatch: Dispatch): MenuItem[] {
  const [countInBars, setCountInBars] = useCountInBars();
  return [
    {
      label: "Count-in",
      submenu: COUNT_IN_CHOICES.map((choice) => ({
        label: choice.label,
        checked: countInBars === choice.bars,
        onClick: () => setCountInBars(choice.bars),
      })),
    },
    // Groove: project-wide swing/feel applied at playback (non-destructive).
    {
      label: "Groove",
      submenu: GROOVES.map((groove) => ({
        label: groove.name,
        checked: project.grooveId === groove.id,
        onClick: () => dispatch({ type: "setGroove", grooveId: groove.id }),
      })),
    },
    {
      label: "Groove amount",
      submenu: GROOVE_AMOUNTS.map((value) => ({
        label: `${Math.round(value * 100)}%`,
        checked: project.grooveAmount === value,
        onClick: () => dispatch({ type: "setGroove", amount: value }),
      })),
    },
  ];
}
