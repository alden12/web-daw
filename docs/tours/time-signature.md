---
title: Time Signature Walkthrough
mode: b            # default drive mode: b = auto-jump editor + links, a = links only
baseref: slice-92-roadmap-graph-polish   # diff base: the fork point before any time-signature work
---

# Time Signature Walkthrough

A diff-aware tour of the changeable time signature feature (`DAW-10`), landed in two
slices: `DAW-10.1` (numerator, simple x/4 meters) and `DAW-10.2` (denominator, compound
x/8 meters). The tour follows the keystone outward: the one project value and its two
helpers, then persistence, the edit/sync path, MCP, and finally the consumers that project
the meter into the grid, the metronome, the recorder, and the UI.

The through-line: a "beat" is always a fixed quarter-note, so **bar length in beats =
`numerator * 4 / denominator`** and the meter's **"shown beat" = `4 / denominator`** (a
quarter in x/4, an eighth in x/8). Two pure helpers compute those, and everything else
reads them - no per-site hardcoding of `4`.

<!-- Presenter notes are short by design; expand them live. `symbol` survives line drift. -->

## 1. The keystone field + the two helpers

- file: `src/audio/project/schema.ts`
- lines: 167-203
- symbol: `timeSignatureSchema`

The single source of truth. `timeSignatureSchema` is `{ numerator, denominator }` (denominator
a power of two); `DEFAULT_TIME_SIGNATURE` is 4/4; `beatsPerBar` and `beatUnitBeats` are the two
pure formulas the whole feature projects. The field is added to `projectDataSchema` as
**optional** (line 203), so older documents heal to 4/4 on load with no schema bump - the same
move `loopStart`/`grooveId` used.

## 2. The store: state, derived getters, coercing setter, heal-on-load

- file: `src/audio/project/projectStore.ts`
- lines: 276-288, 851-860, 1476
- symbol: `setTimeSignature`

`ProjectStore` holds `timeSig` and exposes three getters (`timeSignature`, `beatsPerBar`,
`beatUnit`) that everything reads. `setTimeSignature` **coerces** (clamps the numerator, snaps an
invalid denominator back) - the store's job, distinct from the MCP boundary's validation. `load`
heals a missing field to 4/4 (line 1476). The `isValidDenominator` type guard (line 63) narrows a
plain `number` to the literal-union denominator.

## 3. Persistence round-trip + the agent mirror

- file: `src/audio/project/projectSerialization.ts`
- lines: 52-67, 126-131
- symbol: `snapshotProject`

`timeSignature` joins the `TransportState` and is copied into `ProjectData` by `snapshotProject`,
so it rides save/load, undo checkpoints, and version-history snapshots. The parallel
`buildStructure` (in `projectStructure.ts`) copies it into the reactive `ProjectStructure`, which
is what the UI and the MCP mirror read - so the agent sees the meter too.

## 4. The durable edit: setTimeSignature across the command system

- file: `src/audio/commands/applyEdit.ts`
- lines: 150-152
- symbol: `applyEdit` (setTimeSignature)

`setTimeSignature` mirrors `setTempo` at five sites: the `ServerToBrowser` union (`protocol.ts`),
the `applyEdit` dispatcher (here), the `editLog` coalesce set + key, the `describe` feed text, and
the history `diff`. Being one durable edit means it rides undo/redo, the activity feed, multiplayer
sync, and version history for free - no bespoke plumbing.

## 5. MCP: the set_time_signature tool

- file: `server/mcpServer.ts`
- lines: 1477-1497
- symbol: `set_time_signature`

The agent-facing tool: a numerator plus an optional denominator (validated to the power-of-two set,
default 4). It sends the edit to the live tab and updates the server mirror. `timeSignature` also
joins the `list_tracks` summary so the agent can read the current meter. The bridge routes it as a
generic durable edit, so no bridge handler was needed.

## 6. The grid: beatTicks becomes subdivision-aware  [10.2 core]

- file: `src/ui/timeline/timeGrid.ts`
- lines: 39-52
- symbol: `beatTicks`

The heart of 10.2. `beatTicks` now ticks every **shown beat** (`beatUnitBeats`) and marks a bar
every `numerator` of them. It iterates by tick **index**, not by accumulating beats - so a
fractional bar (7/8 = every 3.5 beats) lands its heavy line exactly on a tick instead of stranded
between beat lines, and there is no floating-point drift in the bar test.

## 7. The Ruler + the three consumer call sites

- file: `src/ui/timeline/Ruler.tsx`
- lines: 15-38
- symbol: `Ruler`

`Ruler` swapped its bare `beatsPerBar` prop for the full `timeSignature` (deriving `beatsPerBar`
locally for the title), so it can pass the whole meter into `beatTicks`. The three callers -
`ArrangementTimeline`, `PianoRoll`, and `CenterWorkbench`'s `AudioClipPanel` - now hand it
`project.timeSignature` (or `projectStore?.timeSignature`, defaulting to 4/4 when absent).

## 8. The metronome: a beatUnit step + downbeat accent  [10.2 core]

- file: `src/audio/sequencer/scheduler.ts`
- lines: 99-123
- symbol: `metronomeClicksInBeatRange`

The metronome's compound-meter change. It gained a `beatUnit` step (default 1, so x/4 is
byte-for-byte unchanged) and clicks each shown beat, accenting the bar downbeat. Like `beatTicks`
it iterates by click index for exact fractional-bar accents. The `Scheduler.tick` call site passes
`this.project.beatUnit`. `metronomeClicksInBeatRange` stays a pure, unit-tested function.

## 9. The recorder count-in

- file: `src/audio/recording/recorder.ts`
- lines: 196-209
- symbol: `start` (count-in block)

The count-in clicks the same shown beat as the metronome, so the count flows straight into
playback in phase. The rename from `countBeats` to `countUnits` here is where a dangling reference
slipped past the incremental typecheck during development - the MIDI-recording e2e caught it, a
reminder that the e2e suite is the real safety net for this kind of edit.

## 10. The UI: the Meter control

- file: `src/ui/TransportBar.tsx`
- lines: 94-127
- symbol: `TransportBar` (Meter label)

The visible surface: a numerator number input and a denominator `<select>` (2/4/8/16) beside the
tempo readout, each dispatching `setTimeSignature`. 10.1 shipped the numerator with a fixed `/4`;
10.2 turned that into the select. Both halves preserve the other's value on change.
