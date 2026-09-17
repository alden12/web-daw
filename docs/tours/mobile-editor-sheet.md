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
things that were found only by running the branch on a real phone.

The spine worth carrying through is one idea and its consequences. **A moving sheet's height
is a lie**, because the cheap way to animate it is to hold it at full height and translate
it. That is fast, and it is also the source of nearly every bug in this branch, because
three separate things measured that height and believed it: the sheet's own scrollers
(section 5), the piano roll centring itself (section 6), and eventually the test helper
(section 13). Everything else follows from the second idea: the sheet is **non-modal**, which
rules out every off-the-shelf library and is what lets a whole synchronisation problem be
deleted (section 11).

## 1. The premise: occlude, don't tab

- file: `src/ui/shell/MobileShell.tsx`
- lines: 1-34
- symbol: `MobileShell`

The previous round defended four bottom tabs on the grounds that they were the *desktop's*
own surfaces rather than navigation invented for mobile. That argument was right and it
pointed somewhere better: the desktop does not tab between them either, it **stacks and
occludes** - `CenterWorkbench` is editor-above-rack floating over the timeline.

So the arrangement became the background and the editor became a sheet over it. Note what
that **deleted** rather than added: the tab bar (~56px plus safe area), the whole `LaneStrip`
component (143 lines, which existed only because the Edit tab took the arrangement away),
and the question of where selection navigates to - it does not, because the arrangement
never leaves.

## 2. A detent is a fraction, not a pixel offset

- file: `src/ui/shell/detents.ts`
- lines: 16-49
- symbol: `detentsFor`

Coverage as a fraction of the workspace, so the address bar collapsing or the phone rotating
needs no recomputation at all. Same instinct as `gridView.ts` storing the arrangement offset
in beats: pick the unit the invariant is expressed in and the maths falls out instead of
needing bookkeeping.

Three sets, and `short` wins over tier - a landscape phone is ~844px wide, so it lands in the
*tablet* tier while being the shortest viewport the app ever sees. The first unit test in
`detents.test.ts:19` guards exactly that.

## 3. What tells a throw from a drag

- file: `src/ui/shell/detents.ts`
- lines: 58-99
- symbol: `projectDetent`

Extrapolate the release point forward by `PROJECTION_MS`, *then* snap to nearest. That is the
whole trick: released in the same place travelling the same direction, only the speed decides
where it lands. At `PROJECTION_MS = 0` flicking stops working entirely and every gesture
degrades to a drag.

`velocityFrom` below it fits across ~100ms of history rather than the last frame - at 120Hz a
single frame delta is mostly sampling noise, and thresholding on it makes a steady drag
register as a flick about one time in five. The `elapsed > 8` guard is the same problem from
the other end: two events in the same millisecond say nothing about speed.

This file is DOM-free on purpose. Vitest here is node-env with no jsdom, so a pure module is
the only way any of this gets unit tests at all - 17 of them in `test/detents.test.ts`.

## 4. The settle is a spring, not a transition

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 105-140
- symbol: `springTo`

A CSS transition restarts from rest and throws away the speed you built with your thumb. That
discontinuity is precisely what reads as "not native". Seeding a spring with the release
velocity costs about ten lines and is the single biggest difference in how the gesture feels.

Two details: the integration is sub-stepped at `MAX_STEP_S`, because a stiff spring at a
variable `dt` does not merely lose accuracy, it goes unstable and flies off; and
`prefers-reduced-motion` skips straight to `commit`, landing in the right place without the
journey.

Also worth noting what is *absent* - no React state write anywhere in this function. The
transform goes straight to the node, the same discipline `useSharedGridScroll` uses, because
a state write per `pointermove` would re-render the arrangement, the roll and the rack at
120Hz.

## 5. Transform while moving, commit layout on settle

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 64-97
- symbol: `commit`

The keystone, and the source of sections 6 and 13. `paint` keeps the sheet at full height and
translates it, which is cheap because nothing relayouts. The shipped-and-broken version had
only that half - so the sheet was *always* laid out at full workspace height, and at Half the
bottom 45% of the editor, including the piano roll's vertical scroller, sat below the screen
where no thumb could reach it. It looked completely fine in a screenshot.

`commit` hands the height back to layout once the sheet has stopped. The swap moves nothing
visually, and the reason is worth holding onto: the sheet is anchored to the bottom, so a box
of `cover` height with no transform has its top edge in exactly the same place as a
full-height box translated down by `(1 - cover)`.

The sting is in the comment on `paint` - "fine for the ~300ms a drag lasts". True of the
sheet, false of anything measuring itself inside it.

## 6. The roll believed the lie

- file: `src/ui/PianoRoll.tsx`
- lines: 215-260
- symbol: `handedOver`

Reported as notes not being visible at Half while Full looked right. The fit-into-view ran
once on mount, and under the sheet the roll is mounted at two heights that are both wrong:
**0px** while parked, where centring degenerates to "put the middle row at the top edge"; and
the **entire workspace** mid-throw, because section 5 holds the sheet at `height: 100%`.
Instrumenting the fit caught it running at `clientHeight` 677 for a viewport that settles at
319. Full only ever looked correct because 566px is tall enough to hide the error.

So it re-fits on every resize - the settle is the last one, so the settled height wins - and
hands over permanently on the first scroll the user makes, which is what stops it overriding
a position somebody chose. The `selfScroll` flag telling its own write from a real one is the
same tell `useSharedGridScroll` uses.

The e2e asserts the invariant rather than an offset: centred means the same content row sits
at the middle of the viewport whatever its height, so `scrollTop + clientHeight / 2` must
agree across detents.

## 7. The one React write in the whole gesture

- file: `src/ui/shell/useSheetDrag.ts`
- lines: 142-215
- symbol: `endDrag`

React hears about the gesture exactly once, on release, and only if the sheet actually
changed detent. Everything before that is `paint` writing to the node.

The `useLayoutEffect` above it packs three decisions into eight lines. `if (dragRef.current)
return` means the finger wins over programmatic changes. The `placed` branch paints rather
than springs on first mount, because the sheet renders with no transform - which is "covering
everything" - so an ordinary effect would flash the whole arrangement covered before dropping
into position. And it is a *layout* effect so that placement happens before the browser
paints at all.

Small thing with a large effect: `onPointerDown` bails on `button, a, input, select`, which is
how the Edit / Clips / Rack switch keeps its taps while living inside the drag surface.

## 8. Non-modal, deliberately

- file: `src/ui/shell/EditorSheet.tsx`
- lines: 1-55
- symbol: `EditorSheet`

The arrangement behind stays live: tap a track there while the sheet is up and the selection
follows without the sheet moving. That single requirement rules out every off-the-shelf
bottom sheet - `vaul` and friends are all built on a modal dialog primitive, so they trap
focus and `inert` the background - and it is why this is *not* `Sheet.tsx`, whose library and
agent panels genuinely are modal.

Two details in the markup. The whole header drags, not just the pill: a 4px grabber is a cruel
target for a thumb. And `touch-action: none` is the line that makes any of this work on iOS -
without it the browser claims the gesture before the first pointer event arrives.

The safe-area inset is on the sheet itself rather than as padding on the workspace, and the
comment says why: an absolutely positioned box resolves against its containing block's
**padding box**, so padding out there is silently ignored. That same rule was the cause of a
real bug in the prototype this branch was designed against.

The whole component is ~90 lines and holds no state. Detent lives in the shell, gesture in the
hook, maths in `detents.ts`.

## 9. Where it opens, and what counts as asking

- file: `src/ui/shell/MobileShell.tsx`
- lines: 278-360
- symbol: `onWorkspaceClick`

It opens at **Half**, and the comment ties that to a property of the app rather than to
taste: there is always a track and a clip selected, so there is always something to edit and
showing it presumes nothing. Opening parked was tried and read as the editor having failed to
open. **If an empty selection ever becomes possible this should go back** - keep the reasoning
attached to the constraint, not to the number.

Getting back to Half from parked took two goes and both are instructive:

- Watching the *selected track* is not enough. `selectTrack` is a no-op when the id already
  matches, so on a one-track project - the state every new project starts in - tapping the
  only lane changes nothing and the shell never sees it. Hence `onWorkspaceClick`, which
  raises on a click anywhere on a track row whether or not the selection moved. A click, not
  a pointerdown, so scrolling while parked is not mistaken for a request to edit.
- Watching for a *changed id* is also not enough, in the other direction: switching project
  replaces the tracks wholesale, so the id changes with nobody having chosen anything. The
  test is whether the track we last saw still exists.

Both are adjusted during render rather than in an effect - React's documented shape for state
that follows a prop, so the re-render lands before paint.

## 10. Two surfaces mounted at once, one ⋮

- file: `src/ui/shell/MobileShell.tsx`
- lines: 374-395
- symbol: `sheetIsUp`

The cost of never unmounting the arrangement. `compact` used to be enough to decide who
published their toolbar into the shell's single overflow menu, because only one surface
existed at a time. Now both do, both would publish, and the later mount would silently win.
`isActiveSurface` follows the detent instead.

The registry itself is worth reading for the shape: a **single slot**, not a broadcast, and
what is published is a *getter* rather than the array - because `MenuItem[]` is rebuilt every
render, so publishing the array would either notify on every render or go stale. The shell's
own `overflowItems` is a function for the same reason one level up, since the shell is not
re-rendered when the active surface's state changes.

`surfacesFor` just below is a `Record<EditorSurface, ReactNode>`, so adding a surface is one
entry here plus one in `SURFACE_ITEMS`, and a missing case is a type error rather than a blank
panel.

Related: `surfaceControls.ts:1`, `usePublishSurfaceControls.ts:14` (note the retract guard -
React can mount the incoming surface before unmounting the outgoing one).

## 11. Pinning the lane instead of copying it

- file: `src/ui/ArrangementTimeline.tsx`
- lines: 139-155
- symbol: `useEffect`

At Full only a sliver of arrangement shows, and it should be the lane being edited. That is
exactly the job `LaneStrip` used to do - by rendering a **second copy** of the grid that had
to be kept in step with the first, which is where `gridView.ts` and `useSharedGridScroll` came
from.

Doing it by scroll position instead is four lines, and it deleted the component. There is one
arrangement now.

`gridView.ts` survives, and its justification had to be re-founded: it is no longer about two
tabs, it is about **remounting** - a window resized past the desktop breakpoint swaps shells,
and a phone rotated into landscape lands in the tablet tier. The beats-not-pixels argument
survives intact and gains a better example, since the header column scrolls on a phone and
sticks elsewhere, so a pixel offset saved before a rotation points at a different bar after
it.

Its initial value is now `null` rather than `0`, which fixed a second reported bug: beat 0 is
the *right* edge of the header column, so opening there scrolled the track names off screen
before you had touched anything.

## 12. Three bugs a laptop could not have found

- file: `src/audio/randomUuid.ts`
- lines: 1-20
- symbol: `randomUuid`

`crypto.randomUUID` is **secure-context-only**: over plain http from a LAN address it is
simply `undefined`. Which is exactly how you test a touch shell on a real phone. The failure
is about as unhelpful as it gets - the first id the app generates throws, `AppShell` never
mounts, blank white page. The login gate had been masking it, because it rendered before any
`ProjectStore` was built.

It turned out to be the first of **four** things gated on a secure context. The others:
`AudioWorklet` (nothing plays), `navigator.storage` (persistence silently falls back to
memory) and `getUserMedia` (no recording). Hence `yarn dev:mobile`, which serves https with a
self-signed certificate, and `worklets/index.ts:26`, which rejects with a sentence rather than
"cannot read addModule of undefined".

Related: `src/index.css:66` - scrollbar styling is now scoped to `@media (pointer: fine)`. With
a mouse a scrollbar is a control you can grab; with a thumb it is only an indicator, and a
10px gutter down every panel is pure loss on a 390px screen.

## 13. What the tests assert, and where they run

- file: `e2e/mobile-shell.e2e.ts`
- lines: 38-58
- symbol: `setDetent`

104 e2e. The division of labour is deliberate: the throw maths is pure and unit-tested, so
Playwright never synthesises a flick - `setDetent` steps the sheet from the keyboard, which is
deterministic. What needs a browser is the wiring.

Its last line is section 5 for the fourth time. `data-detent` flips on the keypress while the
sheet is still mid-spring at `height: 100%`, so the helper polls for **committed layout**
rather than waiting a fixed 500ms. The fixed wait was fine until Half became the default and
Half-to-Peek became a longer throw than anything the suite did before - a fixed timeout is
only ever as good as the longest animation in the suite.

The test that matters most is "every detent leaves the editor a box that fits on screen and
scrolls", which asserts on **geometry** - the sheet's bottom edge against the viewport, and
`scrollHeight > clientHeight` on the roll. The previous tour's honest caveat was that its
tests passed while a panel rendered completely blank. They asserted presence; presence is not
enough, and every device-found bug this week was a geometry bug.

Related: `playwright.config.ts:9`. The port moved from 5179 to 4319 because the `apm` roadmap
viewer binds 5179 and *wanders* through that range on restart, and `reuseExistingServer`
adopts whatever is listening without checking what it is.
