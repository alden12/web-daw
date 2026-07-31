---
title: Mobile Shell Walkthrough
mode: b
diff-base: slice-95-apm-migration # the parent slice, and this PR's base; sections show as diffs
---

# Mobile Shell Walkthrough

How the app came to render on a phone (MOBILE-1) without forking into two apps. The
premise is "swap the shell, not the app": the stores, the param schema and every leaf
panel were already UI-agnostic, so the only thing that did not map to a touch device was
the four-region desktop grid.

The tour goes: the seam that makes two layouts possible, how a device is classified, the
touch shell itself, then the three pieces of machinery the touch shell forced into
existence (a shared grid view, a surface-controls registry, a sheet), and finally the
refactor and the tests. The machinery sections are the interesting ones - each exists
because of a bug, and each ended up useful on desktop too.

## 1. The seam: one prop bag, two layouts

- file: `src/ui/AppShell.tsx`
- lines: 342-380
- symbol: `AppShell`

`AppShell` used to *be* the desktop grid. Now it keeps ownership of the stores, the engine
and every effect, builds one prop bag, and picks a layout with a single ternary - so the
grid moved out to `DesktopShell` unchanged and a second layout became possible without
touching anything stateful.

The contract itself is `shell/types.ts:20` (`ShellProps`), and the rule it encodes is the
one worth remembering: anything a shell may not differ on lives there; anything that is
pure geometry (panel widths, the timeline split) stays private to the shell that has it.

Related: `src/ui/shell/types.ts:20` (the contract), `src/ui/shell/DesktopShell.tsx:1`
(the extracted grid).

## 2. Tier by device, not by width

- file: `src/ui/shell/useDeviceShape.ts`
- lines: 39-78
- symbol: `readDeviceShape`

Three tiers from `pointer: coarse` **and** size, because a coarse pointer is what makes
3px resize handles unusable and no amount of width fixes that. `short` is a separate axis
because a phone in landscape is *wide* (~844px, so it lands in the tablet tier) while
being the shortest viewport the app ever sees.

Two subtleties: a narrow desktop window deliberately gets the touch shell (that is what
makes it e2e-testable without a device), and the snapshot is cached because
`useSyncExternalStore` compares by identity - returning a fresh object each read loops
forever.

## 3. The touch shell's three bands

- file: `src/ui/shell/MobileShell.tsx`
- lines: 572-620
- symbol: `MobileShell`

A fixed top bar, a flexible middle, fixed bottom tabs. The middle band is where the
tablet tier differs: `docked` panels flank the workspace instead of sliding over it,
because covering the thing you are editing in order to pick an instrument for it is a
phone compromise, not a virtue. Same toggle buttons either way, so only the presentation
differs.

Note `docked = shape.tier === "tablet" && !shape.short` - a phone in landscape is in the
tablet tier but must not dock.

## 4. Tabs and views as data

- file: `src/ui/shell/MobileShell.tsx`
- lines: 363-423
- symbol: `views`

The tabs mirror the **desktop workspace areas** (Arrange / Edit / Clips / Devices) rather
than the `ActivityRail` view list, which was round 1's mistake - it mixed workspaces with
side panels. `views` is a `Record<MobileTab, ReactNode>`, so adding a tab is one entry
here plus one in `TAB_ITEMS`, and a missing case is a type error rather than a blank tab.

Related: `TAB_ITEMS` at `MobileShell.tsx:94`; `libraryViews.tsx:1` is the same
data-driven trick for the library's view set, extracted so both shells share it.

## 5. The shared grid view, in beats

- file: `src/ui/arrangement/gridView.ts`
- lines: 1-38
- symbol: `readGridScrollBeats`

Scroll position used to live in a DOM ref inside `ArrangementTimeline`, which was fine
while the timeline was always mounted. The touch shell shows the arrangement and the
selected track's lane in *different tabs*, so a local ref silently loses your place.

Stored in **beats, not pixels**, for two reasons worth reading in the header comment: the
two surfaces have different amounts of chrome before beat 0, and beats survive a zoom
change. The value may be **negative**, meaning "scrolled into the header gutter" - and
flooring it at 0 was a real bug, because it made that indistinguishable from "showing bar
1".

## 6. Restoring without fighting the user

- file: `src/ui/arrangement/useSharedGridScroll.ts`
- lines: 1-51
- symbol: `useSharedGridScroll`

Thirty lines that took three bugs to arrive at. The header comment names the two things
it deliberately does *not* do: it does not subscribe to later changes to the shared
offset, and it does not publish its own restore. Both were bugs - the first made the
timeline catch on the headers whenever you scrolled to the start, the second let the lane
strip's browser-clamped `scrollLeft` overwrite the offset the timeline was relying on.

The `restoring` flag plus a single `requestAnimationFrame` is how a restore is told apart
from a user scroll.

## 7. The lane strip

- file: `src/ui/arrangement/LaneStrip.tsx`
- lines: 91-143
- symbol: `LaneStrip`

The selected track's own lane, pinned above every workspace, so editing a clip never
loses sight of where it sits in the song. It **reuses `Lane`** rather than redrawing
placements, so tap, drag, resize and split behave exactly as in the full arrangement -
there is no second lane implementation to keep in step.

The track's identity sits in a slim title row *above* the lane rather than a header
column beside it: a column costs the same absolute pixels here as in the arrangement, and
this strip is one row tall, so those pixels are better spent on the lane.

## 8. The surface-controls registry

- file: `src/ui/shell/surfaceControls.ts`
- lines: 1-37
- symbol: `setSurfaceControls`

A 390px top bar has room for one overflow menu, so the *active workspace* publishes its
own toolbar as menu-item data and the shell renders it. The design decision is publishing
a **getter, not the array**: building `MenuItem[]` from component state produces a fresh
array every render, so publishing the array would either notify on every render or go
stale. A ref-backed `() => items` means the registry changes only on mount/unmount while
the shell still reads current values when the menu opens.

Related: `usePublishSurfaceControls.ts:14` is the React side - note the dependency-less
effect that refreshes the ref (writing a ref mid-render is unsafe under concurrent
rendering) and the retract guard that only clears its *own* entry.

## 9. One toolbar list, two homes

- file: `src/ui/PianoRoll.tsx`
- lines: 505-545
- symbol: `rollControls`

What the registry buys: `rollControls` is built once and used twice - as the desktop
kebab (`PianoRoll.tsx:563`) and, when `compact`, published to the shell's ⋮. One list per
surface, so the two cannot drift.

Also here: the collapsible velocity lane (`velOpen`), added because in landscape the
velocity selectors left no room for the roll itself, and `effVelH`, which clamps the
persisted preference to a share of the actual viewport.

Related: `ArrangementTimeline.tsx:374` (`optionItems`) does the same thing for the
timeline.

## 10. The sheet that never unmounts

- file: `src/ui/shell/Sheet.tsx`
- lines: 1-48
- symbol: `Sheet`

Slides in from an edge, and **stays mounted once opened**. That is not an optimisation:
the agent panel holds a live interruptible run (AGENT-10), and unmounting it mid-request
would abort work the user is waiting on. While closed it is `inert`, so nothing inside
takes focus or answers a tap. Mounting is still lazy - a sheet never opened renders
nothing.

`everOpened` is adjusted **during render** rather than in an effect, which is the
idiomatic form for state derived from a prop.

## 11. Splitting the workbench

- file: `src/ui/CenterWorkbench.tsx`
- lines: 100-115
- symbol: `CenterWorkbench`

`CenterWorkbench` went from 703 lines to 231 by extracting `workbench/TrackEditor`,
`InstrumentEditor`, `AudioClipPanel`, `DeviceRack` and `TrackRecordButton` - which is
what let the touch shell host the same editor without duplicating it.

The clamp shown here is the interesting survivor, though not where you would expect: a
persisted device-rack height that was fine on a desktop left a ~30px piano roll on a
phone, because the editor's own chrome eats ~90px before the roll gets any. `MIN_EDITOR`
plus a proportional fallback keeps both usable at any height.

The phone was the **discovery mechanism, not the beneficiary**. `CenterWorkbench` is
desktop-only (`DesktopShell` is its sole importer) and the touch shell gives the rack its
own tab, so the two never compete for height there any more. The clamp still earns its
place here, because on desktop they do share one vertical box and `deviceH` is a
persisted absolute while the body moves with the window - drag the rack tall, then shrink
the window, and the squeeze is identical. A small screen forcing a pathological ratio
immediately is a good way to find a latent desktop bug.

Related: `workbench/TrackEditor.tsx:18` reads tempo/meter/loop from the store itself so
neither shell has to thread them through.

## 12. What the tests actually assert

- file: `e2e/mobile-shell.e2e.ts`
- lines: 1-60
- symbol: `test.describe`

24 tests across phone portrait, phone landscape, tablet and desktop viewports. Worth knowing the
limit: Vitest here is node-env with no jsdom, so there are no React component tests and
Playwright is the only thing exercising this UI.

And the honest caveat - these tests passed while the Arrange tab rendered completely
blank. They asserted the panel was visible, and it was; it just had no height. The bug
was found by screenshotting. Assert on geometry, not only on presence.
