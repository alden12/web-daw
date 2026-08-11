---
title: Note Pads Walkthrough
mode: b
diff-base: slice-98-mobile-editor-sheet # the parent slice, and this PR's base; sections show as diffs
---

# Note Pads Walkthrough

How a phone stopped being able only to arrange and started being able to play (MOBILE-6), and
the three things underneath that had to be fixed before it could: the menu, the way surfaces
publish their controls, and the library.

Nine stops. The pads first (premise, layout, how they share the sheet, the gesture, where they
live), then the menu they leaned on hard enough to break, then the library. **If you want the
short version, sections 3, 4, 6 and 7 carry the ideas** - the rest is context and consequence.

Two things run through the whole branch:

- **A pure core, tested without a browser.** Three modules here are DOM-free by design
  (`scales.ts`, `geometry.ts`, `menuPlacement.ts`) and are tested at keys and viewport sizes that
  would be miserable to reproduce by hand. That leaves the e2e for what only a browser can answer -
  `padsOverflow` asks whether the last pad row is *inside the sheet*, which no arithmetic can tell
  you.
- **A phone has no focus.** Several things here were built as if it did - one surface owning the
  menu, a panel that stays open over what it just changed - and each time the fix was to delete the
  arbitration rather than improve it.

## 1. The premise: a phone that could arrange but never make anything

- file: `src/ui/pads/NotePads.tsx`
- lines: 1-31
- symbol: `NotePads`

The touch shell could move clips around and never create one: the only ways to play a note were
the computer keyboard and hardware MIDI, neither of which a phone has.

The decision the rest of the branch hangs off is **a section, not a fourth tab** - you play a
phrase and watch it land in the roll above without changing what you are looking at, which is the
same argument the editor sheet itself was built on.

Recording came free: the pads go out through `LiveNotes`, the seam the keyboard and hardware MIDI
already use, so arm-record-play lands a clip without anything in the pads knowing the recorder
exists.

## 2. The layout generalises the piano rather than imitating it

- file: `src/audio/theory/scales.ts`
- lines: 92-141
- symbol: `padRows`
- related: `src/ui/pads/KitPads.tsx:1`

In-scale notes take a full-width row; everything else sits *above*, in the gaps between them.
`accidentalsFor`'s `seamOf` is the whole idea - an out-of-scale note's position is just how many
in-scale notes fall below it. In C major that puts the accidentals exactly where the black keys
are, not because they were drawn there but because that is where they fall. Other modes cost
nothing: where a gap holds more than one accidental they share the seam instead of stacking.

Positions are in **pad-width units**, so the renderer turns them into percentages and this file
never learns about pixels - which is what makes it testable across every scale on offer.

The subtle line is in `padRows`: each row closes on the octave above. Without that closing tonic
the leading tone has no gap to sit in and vanishes from the row - found by laying it out across six
scales, not by looking at one.

**Where the layout would be a lie, it is not used.** A drum kit has no key, so its pads would be
intervals of a tonic the kit knows nothing about over a General MIDI map. Kit tracks get a grid of
their loaded pads instead, sharing `PadButton` and `usePadTouch` so playing feels identical.

## 3. How the pads and the roll divide the sheet

- file: `src/ui/pads/geometry.ts`
- lines: 34-106
- symbol: `fitPads`
- related: `src/ui/shell/MobileShell.tsx:387` (`editorRoom`)

Read this one as a **correction**. The first version reserved a flat 40px for the roll and capped
the pads at four rows, and the two constants failed in opposite directions: below the cap the pads
absorbed every pixel a taller sheet added, so Half and Full left the roll the same unreadable
sliver; above it, extra room bought nothing at all (which is why it looked identical at both
detents in an emulator, whose viewport is tall enough to clear the cap at Half).

`PADS_SHARE` replaces both - the pads may take 65% of the editor and the surface above keeps the
rest, so raising the sheet grows both. The remaining ceiling is not arbitrary: the room says how
many rows there is *space* for, `OCTAVE_RANGE` how many there are *notes* for.

`ARRANGEMENTS` is the landscape escape hatch as data - an ordered list of concessions, first that
fits a row wins, so the controls' own row is always given up before the roll's share is.

`editorRoom` is derived from the workspace and the detent fraction rather than measured: a sheet
mid-throw is held at full height and translated, so measuring would grow a row during the gesture
and take it back on settle.

## 4. Two gestures that start identically

- file: `src/ui/pads/usePadTouch.ts`
- lines: 1-62
- symbol: `usePadTouch`

Slide-to-glissando and drag-down-to-sustain collide **by geometry**, not by choice: the pad below a
pad is another pad, so "dragged down 34px to latch" and "slid onto the neighbour" are the same
event stream. The first 8px of travel picks the axis and holds it for the press, the way a scroller
does. A slide is therefore horizontal only, which is the shape of a glissando anyway.

`slideTo` (line 148) is where capture bites: every pad captures its own pointer, so events keep
arriving at the pad the gesture *began* on and the target can never say where the finger is -
`elementFromPoint` can. Two edges worth noticing: crossing releases the note it left **unless
another finger is on it** (a two-handed glissando crosses), and a finger over no pad *holds* its
note rather than cutting out, so sliding through the gap above an accidental is a slide and not a
lift.

## 5. A section's height is its content, and it sits under every surface

- file: `src/ui/shell/EditorSection.tsx`
- lines: 1-18
- symbol: `EditorSection`
- related: `src/ui/shell/MobileShell.tsx:696`

Adding a pad row grows the section by exactly one row and the roll gives up exactly that much. An
earlier prototype let the roll resize as a keyboard appeared and it was confusing precisely because
the amount was unpredictable.

Note what the section does *not* do: shrink to fit. Where the content does not fit, the content asks
for less (`fitPads`) - a section that also scaled itself would be a second mechanism arguing with
the first. Same for visibility: the disclosure and nothing else, notably not the detent, or you
collapse a section and something reopens it.

The pads then moved out of the Edit surface entirely and render at the foot of the sheet, so they
are under Clips and Rack too: playing while you turn a filter is as much the point as playing while
you edit notes.

## 6. Every menu level places itself against the viewport

- file: `src/ui/menuPlacement.ts`
- lines: 1-32
- symbol: `placeMenu`
- related: `src/ui/Menu.tsx:140` (`Popover`)

The pads' key menu is a twelve-row list at the bottom of a phone - the worst case for a menu, and it
duly found three bugs that read as different problems: a flyout ran off the bottom, a long menu
could not scroll, and giving one `overflow-y: auto` clipped the *third* level to nothing.

They were one bug. Only the top level was portaled; submenus were absolutely positioned inside their
parent and inherited its clipping and its scrolling. Every level is now portaled and fixed and asks
this module the same question - flip, shift, and *size*, the third being the one only a phone needs.

`Popover` is the other half, and it fixes something subtler: the menu used to close on scroll and on
resize, and **a virtual keyboard is a resize** - so tapping the tempo field would have shut the menu
the field lives in. Each popover now follows its anchor and gives up only when the anchor has left
the viewport, which is what closing was there for.

## 7. Deleting the arbitration instead of fixing it

- file: `src/ui/shell/surfaceControls.ts`
- lines: 1-48
- symbol: `SURFACE_GROUPS`
- related: `src/ui/shell/usePublishSurfaceControls.ts:18`, `src/ui/projectSettings.ts:32`,
  `src/ui/shell/MobileShell.tsx:510`

The shell folds every surface's toolbar into one ⋮, because a 390px screen has room for one. This
used to be a single slot arbitrated by an `isActiveSurface` prop threaded down through the editor to
the roll: whoever was in front owned the menu, and the other surface's controls were simply absent.

That is the desktop's "focus follows the panel" idea on a screen with no focus - at half cover you
are looking at the arrangement *and* the roll. Publishing under a **key** means there is nothing to
arbitrate, so the whole prop chain is deleted rather than improved.

Two details: the group order is this module's rather than the mount order's, so the menu's shape
does not depend on which surface rendered first; and `clearSurfaceControls` retracts an entry only
if it is still ours, because React can mount a replacement before the old one unmounts.

`usePublishSurfaceControls` publishes a **getter**, not an array - items built from a surface's own
state are a fresh array every render, so publishing the array would either notify on every render or
go stale. And the headings made MOBILE-11 undeniable: count-in and groove, filed under
"Arrangement", were visibly in the wrong place, so they build in `projectSettings.ts` now and both
menus that want them ask for them.

## 8. A range is not a list of presets

- file: `src/ui/Menu.tsx`
- lines: 227-300
- symbol: `NumberRow`

Tempo is 20-300 and beats-per-bar 1-32. As submenus they were curated subsets, which made the phone
quietly *less capable* than the desktop fields they stood in for: 174 was on the list and 173 was
unreachable. The field keeps a text draft alongside the value, so typing "1" on the way to "140"
does not snap the project to the minimum and back.

One line is worth stopping on: the input says `[text-align:center]` rather than `text-center`,
because the theme defines a `center` colour - so `text-center` is *also* a text-colour utility, it
sorts after `text-bright`, and the digits came out near-invisible on the field's own background.
Nothing in the class list says so, which is why it says so in a comment.

## 9. The library gets out of the way of what it just did

- file: `src/ui/LibraryPanel.tsx`
- lines: 226-243
- symbol: `picked`
- related: `src/ui/shell/MobileShell.tsx:524` (`onPick`)

The same shape as the menu, elsewhere: on a phone the library is a full-screen sheet over the track
it is editing, so swapping an instrument changed something you could not see. The only visible
result of a tap was the tap.

There was already a wrapper for search results ("act, then clear the query"), and acting on a
library row then getting out of the way turns out to be the same idea - so it generalised and every
row goes through it, rather than one rule per action.

Two things it deliberately does not do: a docked tablet column stays open, because it sits beside
the track rather than over it; and library *management* (deleting a patch, removing a sample) is not
a pick, because it changes the library rather than the track.
