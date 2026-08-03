---
title: Mobile Editor Sheet Walkthrough
mode: b
diff-base: slice-97-euclidean-device # the parent slice, and this PR's base; sections show as diffs
---

# Mobile Editor Sheet Walkthrough

How the touch shell stopped tabbing between its surfaces and started occluding them
(MOBILE-5). The editor is now a sheet over the arrangement, dragged or thrown between three
detents, and the arrangement behind it stays live the whole time.

The tour goes: the premise and what it deleted, then the two halves the gesture is split
into (pure detent maths, then the browser binding), then the sheet element, then how the
shell wires the two surfaces together now that both are mounted at once. It closes with the
three things that were found only by running the branch on a real phone - a reachability
bug, a blank white screen, and a test suite that was silently testing the wrong server.

The theme worth carrying through: almost every design decision here is about **what does
not happen** - no re-render during the drag, no relayout mid-flight, no modal, no second
copy of the arrangement.

## 1. The premise: occlude, don't tab

- file: `src/ui/shell/MobileShell.tsx`
- lines: 1-34
- symbol: `MobileShell`

The previous round defended four bottom tabs on the grounds that they were the *desktop's*
own surfaces rather than navigation invented for mobile. That argument was right and it
pointed somewhere better: the desktop does not tab between them either, it **stacks and
occludes** - `CenterWorkbench` is editor-above-rack floating over the timeline.

So the arrangement became the background and the editor became a sheet over it. Note what
that **deleted** rather than added: the tab bar (~56px plus safe area), the whole
`LaneStrip` component (143 lines, which existed only because the Edit tab took the
arrangement away), and the question of where selection navigates to - it does not, because
the arrangement never leaves.

## 2. A detent is a fraction, not a pixel offset

- file: `src/ui/shell/detents.ts`
- lines: 1-49
- symbol: `detentsFor`

Coverage as a fraction of the workspace, so the address bar collapsing or the phone
rotating needs no recomputation at all. Same instinct as `gridView.ts` storing the
arrangement offset in beats: pick the unit the invariant is expressed in and the maths
falls out instead of needing bookkeeping.

Three sets, and `short` wins over tier - a landscape phone is ~844px wide, so it lands in
the *tablet* tier while being the shortest viewport the app ever sees. The first unit test
in `detents.test.ts:19` guards exactly that.

## 3. What tells a throw from a drag

- file: `src/ui/shell/detents.ts`
- lines: 58-99
- symbol: `projectDetent`

Extrapolate the release point forward by `PROJECTION_MS`, *then* snap to nearest. That is
the whole trick: released in the same place travelling the same direction, only the speed
decides where it lands. At `PROJECTION_MS = 0` flicking stops working entirely and every
gesture degrades to a drag.

`velocityFrom` below it fits across ~100ms of history rather than the last frame - at 120Hz
a single frame delta is mostly sampling noise, and thresholding on it makes a steady drag
register as a flick about one time in five. The `elapsed > 8` guard is the other end of the
same problem: two events in the same millisecond say nothing about speed.

This file is DOM-free on purpose. Vitest here is node-env with no jsdom, so a pure module
is the only way any of this gets unit tests at all - 17 of them in `test/detents.test.ts`.

## 4. The settle is a spring, not a transition

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 104-140
- symbol: `springTo`

A CSS transition restarts from rest and throws away the speed you built with your thumb.
That discontinuity is precisely what people read as "not native". Seeding a spring with the
release velocity costs about ten lines and is the single biggest difference in how the
gesture feels.

Two details: the integration is sub-stepped at `MAX_STEP_S`, because a stiff spring at a
variable `dt` explodes on a dropped frame; and `prefers-reduced-motion` skips straight to
`commit`, so the sheet still ends up in the right place without animating.

Also worth knowing what is *absent* - there is no React state write anywhere in this
function. The transform goes straight to the node, the same discipline `useSharedGridScroll`
uses, because a state write per `pointermove` would re-render the arrangement, the roll and
the rack at 120Hz.

## 5. Transform while moving, commit layout on settle

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 64-97
- symbol: `commit`

The bug section. `paint` keeps the sheet at full height and translates it, which is cheap
because nothing relayouts. The shipped-and-broken version had only that half - so the sheet
was *always* laid out at full workspace height, and at Half the bottom 45% of the editor,
including the piano roll's vertical scroller, sat below the screen where no thumb could
reach it. It looked completely fine in a screenshot.

`commit` hands the height back to layout once the sheet has stopped. The swap moves nothing
visually, and the reason is worth holding onto: the sheet is anchored to the bottom, so a
box of `cover` height with no transform has its top edge in exactly the same place as a
full-height box translated down by `(1 - cover)`.

## 6. The one React write in the whole gesture

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 142-210
- symbol: `endDrag`

React hears about the gesture exactly once, on release, and only if the sheet actually
changed detent. Everything before that is `paint` writing to the node.

The `useLayoutEffect` above it is subtler than it looks. It exists to follow the detent when
something *else* moves it (a keyboard step, a track selection), but the `placed` ref makes
the very first placement a `paint` rather than a spring - the sheet renders with no
transform, which is "covering everything", so springing into position from an ordinary
effect showed one frame of the sheet over the entire arrangement. It is a layout effect for
the same reason.

Small thing with a large effect: `onPointerDown` bails on `button, a, input, select`, which
is how the Edit / Clips / Rack switch keeps its taps while living inside the drag surface.

## 7. Non-modal, deliberately

- file: `src/ui/shell/EditorSheet.tsx`
- lines: 1-55
- symbol: `EditorSheet`

The arrangement behind stays live: tap a track there while the sheet is up and the selection
follows without the sheet moving. That single requirement rules out every off-the-shelf
bottom sheet - `vaul` and friends are all built on a modal dialog primitive, so they trap
focus and `inert` the background - and it is why this is *not* `Sheet.tsx`, whose library
and agent panels genuinely are modal.

Two details in the markup. The whole header drags, not just the pill: a 4px grabber is a
cruel target for a thumb. And `touch-action: none` is the line that makes any of this work
on iOS - without it the browser claims the gesture before the first pointer event arrives.

The safe-area inset is on the sheet itself rather than as padding on the workspace, and the
comment says why: an absolutely positioned box resolves against its containing block's
**padding box**, so padding out there is silently ignored. That same rule was the cause of a
real bug in the prototype this branch was designed against.

## 8. Two surfaces mounted at once, one ⋮

- file: `src/ui/shell/MobileShell.tsx`
- lines: 326-345
- symbol: `sheetIsUp`

The cost of never unmounting the arrangement: `compact` used to be enough to decide who
published its toolbar into the shell's overflow menu, because only one surface existed at a
time. Now both do, both would publish, and the later mount would silently win. `isActiveSurface`
follows the detent - the arrangement owns the ⋮ while the sheet is parked and hands it over
once it is up.

`surfacesFor` just below is a `Record<EditorSurface, ReactNode>`, so adding a surface is one
entry here plus one in `SURFACE_ITEMS`, and a missing case is a type error rather than a
blank panel.

Related: `ArrangementTimeline.tsx:465` (`compact && isActiveSurface`), `surfaceControls.ts:1`
(the registry itself, from the previous slice).

## 9. The band above the sheet

- file: `src/ui/shell/MobileShell.tsx`
- lines: 536-562
- symbol: `MobileShell`

The arrangement is sized to `1 - detents[detent]` so its own horizontal scroller stays on
screen rather than sitting under the sheet - the other half of section 5's fix. **Committed
detents only**: during a drag the sheet slides over this rather than resizing it every frame.

`relative` on the column is load-bearing on a tablet: the sheet positions against the
workspace, not the shell, so it does not run under a docked library or agent.

And no sheet at all without a selected track - an empty editor over the arrangement is just
a lid.

## 10. Pinning the lane instead of copying it

- file: `src/ui/ArrangementTimeline.tsx`
- lines: 139-155
- symbol: `useEffect`

At Full only a sliver of arrangement shows, and it should be the lane being edited. That is
exactly the job `LaneStrip` used to do - by rendering a **second copy** of the grid that had
to be kept in step with the first, which is where `gridView.ts` and `useSharedGridScroll`
came from.

Doing it by scroll position instead is four lines, and it deleted the component. There is
one arrangement now.

## 11. Three bugs a laptop could not have found

- file: `src/audio/randomUuid.ts`
- lines: 1-20
- symbol: `randomUuid`

`crypto.randomUUID` is **secure-context-only**: over plain http from a LAN address it is
simply `undefined`. Which is exactly how you test a touch shell on a real phone. The failure
is about as unhelpful as it gets - the first id the app generates throws, `AppShell` never
mounts, blank white page, nothing in the UI to say why. The login gate had been masking it,
because it rendered before any `ProjectStore` was built.

19 call sites swapped across 10 files. `getRandomValues` carries no such restriction, so the
fallback assembles a v4 UUID from it; `test/randomUuid.test.ts:35` asserts the version and
variant *bits*, not just that the string matches a loose regex.

The other two from the same evening: the reachability bug in section 5 (visible only with a
thumb) and the login redirect, fixed by running the dev server with `--mode test` so the
committed `.env.test` blanks the Supabase keys.

Related: `src/index.css:66` - scrollbar styling is now scoped to `@media (pointer: fine)`.
With a mouse a scrollbar is a control you can grab, so it earns permanent space; with a
thumb it is only an indicator, and a 10px gutter down every panel is pure loss on a 390px
screen.

## 12. What the tests assert, and where they run

- file: `e2e/mobile-shell.e2e.ts`
- lines: 29-54
- symbol: `setDetent`

26 tests. The division of labour is deliberate: the throw maths is pure and unit-tested, so
Playwright never synthesises a flick - `setDetent` steps the sheet from the keyboard, which
is deterministic. What needs a browser is the wiring.

The test that matters most is `mobile-shell.e2e.ts:138`, "every detent leaves the editor a
box that fits on screen and scrolls". It asserts on **geometry** - the sheet's bottom edge
against the viewport, and `scrollHeight > clientHeight` on the roll - because the previous
tour's honest caveat was that its tests passed while a panel rendered completely blank. They
asserted presence; presence is not enough.

Related: `playwright.config.ts:9`. The port moved from 5179 to 4319 because the `apm`
roadmap viewer binds 5179 and *wanders* through that range on restart, and
`reuseExistingServer` adopts whatever is listening without checking what it is. Running the
viewer and `yarn test:e2e` together silently tested the roadmap viewer instead of the app,
and every locator missed in a way that pointed nowhere near the cause.
