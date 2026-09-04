# UI refresh: token retune, light mode, and a button system

Plan for landing the design direction worked out in the shell-concepts mockup
(published artifact, "web-daw shell concepts"). Nothing here is a library
adoption: the whole visual change is token values plus a handful of components.
React Aria is a separate, later, invisible decision and is deliberately out of
scope for this document.

Status: in progress. Written 2026-09-04.

- [x] **Spike**: Tailwind v4 `@theme` override. Confirmed working, see below.
- [x] **Slice 1**: `--color-bright` renamed to `--color-strong` (37 files).
- [x] **Slice 2**: dark ramp retune + the `--color-stage` remap.
- [x] **Slice 3**: controls (arc knob, thin-track fader, vertical fader cap).
- [x] **Slice 3.5**: pitched-roll label gutter, and the device rack as a panel.
- [ ] Slice 4: light mode.
- [ ] Slice 5: button system.

## How well does it actually apply?

Better than expected, because the codebase already routes almost everything
through named tokens. Concrete evidence from the current tree:

- **The palette is one block.** `src/index.css:14-37`, a single `@theme`. Retuning
  the dark ramp is one edit to eleven values.
- **Only 13 hardcoded theme-hostile colours exist** in the whole of `src/`
  (enumerated below). Every other colour already goes through a token. This is
  the single biggest reason light mode is tractable rather than a rewrite.
- **`--color-stage` has 3 usages.** The mockup repurposes it (it stops meaning
  "the centre surround" and starts meaning "the raised panels inside it"), and at
  three call sites that is a safe rename-in-place.
- **`Waveform.tsx` already resolves its colours from CSS at runtime**
  (`src/ui/Waveform.tsx:76-79`), so canvas is not a blocker, only a small fix.

The parts that are real work:

- **There is no shared `Button` component.** `bg-card` appears ~38 times across
  24 files as bespoke Tailwind class strings. A button system means building the
  component first, then migrating call sites.
- **`--color-bright` is named for its appearance, not its role**, and it is used
  across 35 files. It is the one token that genuinely breaks in light mode. See
  Part 2.

### Effort at a glance

| Slice | Size | Why |
| --- | --- | --- |
| Dark ramp retune | Hours | Eleven values in one `@theme` block |
| Knob + fader restyle | Half a day | `Knob.tsx` (339 lines) and `MixerControls.tsx` (123 lines), both self-contained |
| Light mode | A day or two | Second token set, plus the 13 hardcoded sites and the `--color-bright` rename |
| Button system | Several days | Needs a component that does not exist yet, then ~24 files migrated |

## Part 1: Theme colours

Names stay exactly as they are. Only values move, except `--color-bright`
(Part 2) and `--color-stage`, whose meaning changes.

All values in `src/index.css:14-37`.

| Token | Today | Dark (new) | Light (new) | Uses | Role |
| --- | --- | --- | --- | --- | --- |
| `--color-ground` | `#101216` | `#0a0c0e` | `#ffffff` | 47 | App background, inputs, lane grids, the centre surround, device bodies |
| `--color-rail` | `#14171c` | `#0f1216` | `#fafafa` | 12 | Activity rail, library, toolbars |
| `--color-panel` | `#1a1d24` | `#14171c` | `#ffffff` | 13 | Agent panel, track headers, the device tray, mobile sheets |
| `--color-stage` | `#22262f` | `#101317` | `#ffffff` | 3 | **Meaning changes.** No longer the centre surround; now the raised panels in it (piano roll, device rack) |
| `--color-card` | `#2b313c` | `#242a33` | `#f4f4f5` | 38 | Buttons, clip blocks, menus |
| `--color-line` | `#363d49` | `#2a3038` | `#e4e4e7` | 149 | Borders. In light these carry the structure |
| `--color-line-soft` | `#282e38` | `#1c2129` | `#eeeef0` | 4 | Softer borders, beat lines |
| `--color-ink` | `#e8e6e0` | `#e8e7e3` | `#16181c` | 83 | Body text, kept faintly warm on purpose |
| `--color-bright` | `#ffffff` | see Part 2 | see Part 2 | 57 | Emphasised text |
| `--color-muted` | `#868c99` | `#8b929c` | `#6a6f78` | 99 | Secondary text, labels |
| `--color-faint` | `#5c626e` | `#5f656f` | `#9aa0aa` | 99 | Tertiary text, inactive icons |
| `--color-you` | `#56c7c2` | unchanged | `#0d9488` | - | Your edits, playhead, selection, primary accent |
| `--color-agent` | `#a884f3` | unchanged | `#7c5cde` | - | Built-in agent |
| `--color-claude` | `#d9775a` | unchanged | `#c2532f` | - | MCP / Claude driver, record |
| `--color-good` | `#2ecc71` | unchanged | `#15a34a` | - | Success |
| `--color-warn` | `#f1c40f` | unchanged | `#ca8a04` | - | Warning, solo |

Two rules behind the dark column:

1. **Every tier drops one step deeper.** This buys contrast headroom, which is
   what makes the accents read without having to raise their saturation.
2. **The centre is a void, not a platform.** `ground` does the most work: it is
   the app background *and* the centre surround *and* the device bodies. `stage`
   is the single step up, used only for the surfaces you actually work on. This
   inverts the current hierarchy, where `stage` is the lightest chrome.

And the rule behind the light column: **the ramp deliberately collapses.**
Almost every surface goes white and `--color-line` does the separating. Stacked
greys read as depth on a dark ground and as grime on a light one. Only the rail
keeps a barely-off-white.

The voice colours are unchanged in dark and darkened in light purely for
contrast against white. They stay the identity in both.

## Part 2: The `--color-bright` problem

`--color-bright: #ffffff` (`src/index.css:22`), used across 35 files.

The name describes an appearance, not a role, so it cannot survive a light
theme: in light mode "emphasised text" needs to be near-black, and a token
called `bright` holding `#16181c` is a lie that every future reader has to
decode.

This is worth fixing carefully because `src/index.css:6-12` already carries a
comment establishing exactly this rule (name tokens after their ROLE), written
after `--color-center` collided with the `text-center` utility. `bright` is the
same class of mistake, currently invisible because there is only one theme.

Proposed: rename to **`--color-strong`**, value `#ffffff` in dark and `#16181c`
in light. Mechanical rename of `text-bright` to `text-strong` and friends across
35 files, best done as its own commit so it is reviewable as a pure rename with
no value change, before light mode lands.

## Part 3: Elements that change

### Surfaces (done in slice 2)

Values, plus four call sites whose meaning moved:

- `CenterWorkbench.tsx:151,168` went `bg-stage` to `bg-ground`. The centre is now
  the void.
- `CenterWorkbench.tsx:217` (the device-rack band) gained `bg-stage`. It had no
  surface of its own before and simply inherited the centre.
- `PianoRoll.tsx:641` went `bg-ground` to `bg-stage`. It is a raised panel now,
  not a well.
- `ArrangementTimeline.tsx:548` (the group-row lane filler) went `bg-stage/40` to
  `bg-panel/40`. It is arrangement chrome, and `stage` no longer means anything
  outside the workbench, so leaving it would have been a silent lie.

### Controls (contained, best return on effort)

| Element | File | Change |
| --- | --- | --- |
| Knob | `Knob.tsx` `NumberKnob` | Pointer tick becomes an **arc**: value is the length of the sweep, not just the angle of a mark. Conic gradient from 225deg over a punched-out face, with the tick kept for precision |
| Vertical fader | `Knob.tsx` `NumberSlider` | 2px visible track, accent fill, **16x8 fader cap** outlined in the author's colour |
| Fader | `MixerControls.tsx` `Fader` | 2px track, accent fill, **9px ring handle** replacing the triangle ticker |
| Waveform | `src/ui/Waveform.tsx` | No visual change, but see the theme bug below |

All three tint by **author**, not by a fixed accent, so the arc and the fill go through
`authorHex` / `authorFillStyle` rather than `--color-you`. A collaborator's edit still
shows in their own hue.

Two things fixed while in there, both pre-existing:

- **The vertical fader's cap was off by half its height.** It used `-translate-y-1/2`
  against a `bottom` offset, which shifts the cap *up* when centring on a `bottom`
  anchor needs it shifted *down*. Now `translate-y-1/2`.
- **The vertical fader's hit area was its 8px-wide track.** The interactive box is now
  24px wide with the 2px track drawn down the middle, so thinning the visuals did not
  thin the target. Same principle the 9px mixer handle relies on.

All three share one rule, which is what makes them read as a family rather than
three borrowed widgets: **a 2px track, and the accent is the filled portion**.

### Layout (done in slice 3.5)

Two things the mockup did that the app did not, neither of them token work.

- **The pitched roll reserves a label gutter, and names every row.** `RollRows.gutter` and
  the sticky-left column already existed and were already used by `DrumRoll`
  (`gutter: 92`); only `CHROMATIC_ROWS` opted out, so labels floated over the grid. It now
  sets `gutter: 38` (wide enough for "C#-1") and labels all 128 rows rather than only the
  Cs. A new optional `RollRows.labelPriority` grades each label so density follows zoom,
  because 128 names at the default 12px row is a wall of text: **0** = the octave Cs,
  always shown and styled as landmarks (`text-ink` against `text-faint`); **1** = the
  naturals, from `LABEL_TIERS.naturals` (11px) up; **2** = the accidentals, from
  `LABEL_TIERS.all` (16px) up. `ZOOM_Y.min` is 7, and 9px text in a 7px row would spill
  into its neighbours, so the bottom of the range shows Cs alone. Omitting the function
  (as `DrumRoll` does) shows every label always, since pads are sparse.
- **The clip rail sits on `--color-panel`.** It had no surface of its own and inherited the
  near-black centre, which left it reading as empty space rather than as chrome.
- **The device rack is a panel, not a band.** It was full-bleed with a `border-t`, while
  the notes surface above it was a rounded bordered card. Two sibling things reading as
  different kinds. The rack now takes the same card treatment inside a `px-3 pb-3` band,
  so the resize handle still grabs the boundary.
- **The workbench is a rail beside a column.** The clip rail used to sit beside the notes
  only, with the rack spanning the full width underneath, so the two panels were not
  left-aligned. `bodyRef` is now the row, holding the full-height clip rail and a column
  containing the notes surface and the rack. The rack's height clamp is unchanged, because
  the row and the column measure the same height.
- **The record button sits at the foot of the rail.** `ClipRail` renders `footer` last; in
  the vertical orientation it now gets `mt-auto`, so a full-height rail puts it at the
  bottom instead of trailing the last clip. Other orientations keep it inline via
  `contents`, so the mobile grid layout is untouched.
- **One grey for chrome, one for wells.** The clip rail, the roll header and label gutter,
  the shared `Ruler` and the device-rack header all sit on `--color-panel`. The device
  cards moved the other way, from `--color-card` to `--color-ground`, so they read as dark
  wells inside the lighter rack tray rather than as the lightest thing on screen. The
  active editor tab lost its `bg-card/50` fill: the bar sits on `ground` and the teal
  underline is what marks selection.
- **The sticky label gutter went from `z-6` to `z-20`.** It sat below both the velocity
  lane and the `Ruler` (each `z-10`), so scrolling dragged them across the note names.
  Above both, the names stay put and the scrolling content passes behind them.
- **The roll's clip-name row is gone.** `ClipRail` already names the active clip and owns
  the rename (`ClipRail.tsx:180`), so the copy in `InstrumentEditor` was a second rename
  affordance for the same value and a row of vertical space. The drum-kit Keys/Pads toggle
  that shared the row is kept, now rendered only on kit tracks.

### Buttons (the biggest lift)

Agreed system from the mockup:

- **Text buttons**: a subtle grey pill at rest, `color-mix(in srgb, var(--color-ink) 9%, transparent)`.
- **Icon buttons**: nothing at rest. An icon is already a shape; a box around it
  is a second container saying the same thing twice.
- **Active state**: an accent-tinted pill, in the control's semantic colour
  (teal for play, coral for record). Same footprint as the resting state, so
  **nothing shifts on activation**.
- **Grouped choices**: a real segmented control.

There is no `Button` component today, so this needs, in order:

1. A `Button` / `IconButton` / `Segmented` trio under `src/ui/controls/`.
2. Migration of the ~24 files currently hand-rolling `bg-card border border-line
   rounded-md ...` strings.
3. `TransportBar.tsx` first, since it is the densest and most-used instance and
   will surface anything the components got wrong.

The segmented control has three obvious first customers regardless of the button
work: snap division, zoom, and the Melodic/Drums switch, all currently loose
buttons pretending not to be a group.

## Part 4: What blocks light mode

Thirteen hardcoded colours, all of which assume a dark ground. Each needs a
token or a theme-aware value.

| Site | What it is | Fix |
| --- | --- | --- |
| `src/index.css:76,88,94` | Scrollbar thumb, `rgba(255,255,255,...)` | Token, or `color-mix` off `--color-ink` |
| `src/ui/PianoRoll.tsx:551-552` | Grid gradients, `rgba(255,255,255,0.05)` | `--color-line-soft` |
| `src/ui/PianoRoll.tsx:733` | Black-key rows, `bg-black/25` | `color-mix` off `--color-ink` |
| `src/ui/PianoRoll.tsx:743` | Scale-tone highlight, `bg-white/[0.035]` | Same |
| `src/ui/timeline/Ruler.tsx:60,63` | Outside-loop shading, `bg-black/30` | Needs to become a *lightening* in light mode, not a darkening |
| `src/ui/shell/Sheet.tsx:58` | Scrim, `bg-black/55` | Fine in both, but wants softening in light |
| `src/ui/shell/Sheet.tsx:69-70` | Edge-sheet shadows, `#000` | Token |
| `src/ui/shell/EditorSheet.tsx:58` | Bottom-sheet shadow, `#000` | Token |

Plus two behavioural items:

- **`Waveform.tsx:76-79` resolves `--color-you` and `--color-claude` once** into
  a canvas draw. Correct today, wrong the moment a theme can change at runtime:
  the canvas keeps the old colours until something else forces a redraw. Needs
  the theme as an effect dependency, or a `MutationObserver` on the theme
  attribute.
- **Opacity modifiers change character on a light ground.** `bg-card/40` and
  `bg-card/60` (in `AgentPanel.tsx` and elsewhere) are tuned against a dark
  backdrop and will need re-checking, not just re-valuing.

### Spike result: the `@theme` override works

Verified against a real `vite build` of the current tree, by reading the emitted
CSS rather than by reasoning about it.

- Tokens are emitted as custom properties on `:root, :host`, e.g.
  `--color-ground:#101216`.
- Plain utilities reference them: `.bg-ground{background-color:var(--color-ground)}`,
  `.text-ink{color:var(--color-ink)}`, `.border-line{border-color:var(--color-line)}`.

So redefining the tokens inside `[data-theme="light"]` will repaint every plain
utility. **Light mode does not need the semantic layer moved out of `@theme`.**

**One caveat, found in the same output.** Opacity modifiers compile to a pair:

```css
.bg-card\/40 { background-color: #2b313c66 }                                  /* baked fallback */
@supports (color: color-mix(in lab, red, red)) {
  .bg-card\/40 { background-color: color-mix(in oklab, var(--color-card) 40%, transparent) }
}
```

The `@supports` branch is theme-reactive and wins everywhere `color-mix` is
supported (Chrome 111, Safari 16.2, Firefox 113, all 2023). The baked fallback
would show the *dark* value in a light theme on an older browser. Given this app
needs Web Audio, AudioWorklet and OPFS, no browser that can run it lacks
`color-mix`, so this is a documented quirk rather than a blocker.

## Part 5: Suggested slicing

Each of these is independently shippable and independently revertable.

1. **`--color-bright` to `--color-strong`.** Pure rename, no value changes. Lands
   the naming rule from `index.css:6-12` before it matters.
2. **Dark ramp retune.** Eleven values plus the three `--color-stage` call sites.
   Visible, cheap, and it stands alone even if nothing else lands.
3. **Controls.** Arc knob, thin-track fader, vertical fader cap. Self-contained
   files, high return.
4. **Light mode.** The second token set, the 13 sites, the `Waveform` fix, the
   opacity-modifier audit. Gated on the Tailwind v4 spike above.
5. **Button system.** The components, then `TransportBar`, then everything else.
   Largest and last, because it is the only slice that touches file count rather
   than values.

## Part 6: Risks

- **The button migration is the only slice that can sprawl.** 24 files of
  bespoke class strings is where "a design refresh" quietly becomes a month. If
  it gets uncomfortable, shipping the components plus `TransportBar` only, and
  migrating the rest opportunistically as files are touched, is a legitimate
  stopping point.
- **The centre-becomes-a-void change is a real reversal** of the current
  hierarchy, and the comment at `src/index.css:3-5` documents the existing
  intent ("so the center workbench reads brightest"). That comment has to change
  with the values, or the next reader will treat the new ramp as a bug.
- **Light mode doubles the surface area of every future colour decision.** Worth
  being deliberate that this is wanted, not just possible.
- **Nothing here has been tested against the mobile shell at speed.** The sheet
  sits on `--color-panel` directly over the arrangement, so panel-versus-ground
  separation is doing overlay work that a desktop layout never asks of it.
