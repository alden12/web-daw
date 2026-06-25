# Web DAW - Design & Architecture Notes

Status: living design document. Captures the vision and architecture direction as of
2026-06-21, after slice 5 (effect chains). Slices 1-5 are built; this doc is the target
for slice 6 (UI refinement) and the north star beyond it. Nothing past slice 5 is
implemented yet. A clickable wireframe (v5) accompanies this thinking; see the end.

This is the reference write-up for "where the thinking is." It should be updated as
decisions firm up, and trimmed when reality overtakes it.

---

## 1. The thesis

An open-source, web-based DAW where three ideas reinforce each other:

1. **The parameter schema is the keystone.** Every parameter of every instrument and
   effect is declared once, declaratively. The UI, the MCP control surface, automation,
   and save/load are all projections of that one model. Add a parameter to the schema and
   it shows up everywhere for free.
2. **The session is a document co-edited by a human and an AI.** Claude is not a side
   feature; it is a second author working the same model you do. The product's job is to
   make the agent's presence, reach, and history legible.
3. **Everything is structured data flowing through one store as discrete, authored
   events.** This single fact is what makes presence, history, versioning, file export,
   and a pluggable agent all cheap rather than bolted-on. We keep returning to it.

What makes it different from Ableton/Logic/etc.: the AI co-author, the version-control
model, fearless experimentation, and tinkerability on a software level - all of which
fall out of points 1-3.

## 2. Architecture recap (what already exists)

- `src/audio/params/` - the keystone. `ParamSchema` (discriminated union of number/enum/
  boolean specs), `ParamStore` (single source of truth: get/set/subscribe/snapshot/load,
  coerce + validate), `binding.ts` (`ParamBinding`, `rampParam`, `bindParams` - the seam
  that keeps the store transport-agnostic so native audio can become worklets later).
- `src/audio/instruments/` and `src/audio/effects/` - each a pure, DOM-free `catalog.ts`
  (labels + schemas, so the Node server type-checks without the DOM) plus a DOM
  `registry.ts` of factories. Subtractive + FM instruments; Delay/Distortion/Reverb/Filter
  effects, all behind a uniform wet/dry `mix`.
- `src/audio/project/projectStore.ts` - the structural top: tracks, each owning a
  ParamStore + ClipStore + an ordered effect chain. snapshot/load round-trips everything.
- `src/audio/engine/AudioEngine.ts` - realizes the project as audio; per track
  `instrument -> fx... -> trackGain -> master -> limiter -> destination`.
- `src/audio/mcp/` + `server/` - the control plane. A Node MCP server mirrors a
  ProjectStore and forwards validated, track-addressed edits to the browser over a
  WebSocket; the browser mirrors its own edits back. `protocol.ts` is a shared typed union
  so the two ends cannot drift.
- `src/audio/persistence.ts` - localStorage snapshot/restore (key `web-daw:project:v3`).

Everything below builds on these primitives.

## 3. Layout & UX

**Spatial spine (video-editor style, not Ableton):**

- **Full-width timeline along the bottom** - the arrangement overview, the time axis.
- **Center = the workbench for the selected track/clip** - its device chain (instrument +
  effects as a horizontal signal flow) plus tabs for MIDI / Automation / Audio. One
  focused surface instead of every panel at once.
- **Library on the left** - instruments / effects / plug-in devices as a collapsible
  tree. The search box doubles as a prompt.
- **AI agent pane on the right** - chat + activity feed + composer.

**Mode toggle (Converse / Balanced / Produce):** resizes the agent pane. Produce collapses
it to a thin presence rail. The agent is never fully gone, so the collaboration never
disappears even in hands-on editing.

**Two-voice color:** teal = the user's edits, coral = Claude's. It runs through clips,
the activity feed, the focus glow, and the AI cursor. The palette literally encodes
authorship, which is the product's thesis made visible.

**AI presence:** when Claude touches a control it animates in place ("AI cursor"); the
focused track glows; the activity feed narrates every action. No spooky action at a
distance.

**The axis principle:** horizontal = playback time; **vertical = "other ways this could
go"** (clip variants, version history, branches all stack downward). Protect this: time
goes right, alternatives go down, everywhere.

**Panel value hierarchy:** deliberate value staircase so the eye knows where to land -
center workbench brightest, side panels a step darker, timeline its own dark band, cards
(devices/clips/variants) lighter still, dividers strong enough to read the seams.

## 4. Track organization: grouping as the default

The reason track lists spiral is that the flat list is the primitive and grouping is a
manual overlay. Invert it:

- **The project is a tree of buses, not a flat list.** Every track is born into a group;
  a fresh project seeds sensible groups (the routing hierarchy: Rhythm, Tonal, etc.).
- **A group is structurally a track-of-tracks** with its own gain and effect chain, so it
  reuses the slice-5 routing wholesale. Solo/mute/volume/automation/FX all work at the
  group level.
- **Groups are visible labeled sections that collapse on demand** (collapsing is the
  deliberate "give me room" action, not the default - the time-based feel stays
  accessible).
- **Claude is the librarian:** because the agent creates tracks, it files them into the
  right group automatically (tag each instrument in the catalog with a default family).
  Organization is maintained as the music is built, not patched up later.
- Groups are MCP-addressable like tracks and effects.

Open question: music has two organizing axes, by role (the bus tree) and by song section
(intro/verse/chorus). Current lean: bus tree is the structural default; sections live on
the timeline as labeled regions.

## 5. Parameters & automation

Automation is just a parameter over time: a list of breakpoints `{beat, value, curve}`
bound to a param id. Because parameters are the keystone:

- **It renders itself.** The lane's axis, bounds, and interpolation come straight from the
  schema (cutoff is exponential, level is linear; units label the axis). Zero per-parameter
  code, same dividend the knobs get.
- **Claude can write it.** "Ramp the cutoff 400 -> 4000 over bars 5-8, exponential" is one
  tool call that writes breakpoints; the curve appears in coral. Hand-drawing stays
  available, it is just no longer the only way.
- **Recording is nearly free.** Every knob move is already a timestamped event; capture the
  stream against the transport position and you have recorded automation.

Where it lives spatially: the timeline shows that automation exists (a faint curve overlay
/ badge on the clip, with optional inline lanes for quick nudges); the center workbench
(an Automation tab) is where you and Claude actually shape it, scoped to one track with
room to draw.

## 6. Clip variants (fearless iteration)

> **Update (slice 13):** the variant *stack that bundled the sound* (below) was superseded by a
> **track-level sound + a pool of clips** (clips are just notes; params/effects belong to the
> track) - see section 11. The fearless-iteration intent survives as the clip pool + non-
> destructive editing; "Try"/fork becomes duplicate (drag-loop / copy-paste), and clip
> launching landed in slice 14 (a launched clip loops, overriding the timeline - launchable
> slots without a separate mode). Kept here for rationale.

The point: remove the fear of experimenting by making it non-destructive and complete.

- **A variant snapshots the whole sound** - clip notes plus the instrument's params plus
  the effect chain - not just notes like an Ableton clip. Switching variants morphs the
  devices to match. Cheap because every store already has `snapshot()`/`load()`; a variant
  is a bundle of three snapshots.
- **Non-destructive by default.** A one-gesture "Try"/fork clones the active variant into a
  new editable one; the original is parked, never overwritten. Optionally auto-capture a
  restore point before heavy edits, so "I didn't mean that" is always one click back.
- **Claude generates takes on request** ("three variations: busier, sparser, syncopated"),
  tagged coral, parked in the stack for you to audition and keep.
- **The Session "Grid" view is the same variants** seen as launchable slots. One feature,
  two views.

Variants stack on the vertical axis (per the axis principle); they are the lightweight,
per-clip end of the same spectrum as project branches.

## 7. History & versioning (git / Onshape style)

We already emit the exact event stream this is made of: every edit is a discrete, authored
protocol message into the store (the activity feed is a live window onto it).

- **Persist that ordered, authored log** and scrub / rollback / branch is largely free
  (replay messages up to index N).
- **Versions = commits, branches = arrangement variations.** Branch to try "a different
  drop," A/B against main, merge or discard. A perfect job for Claude: rework a section on
  a branch and effectively open a PR you review.
- **Back it with real git** by serializing the project to stable, sorted, line-oriented
  text and committing on version-save; branches map to git branches. You then get the whole
  ecosystem (GitHub, blame, PRs - fitting, since we already stack PRs for the code) and an
  arrangement you can literally PR.
- **But diff/merge semantically.** Two people editing the same clip is a musical conflict,
  not a line conflict. Git stores and transports; a thin layer on top understands
  tracks/clips/params and renders diffs and resolves merges in musical terms ("Branch B:
  Lead cutoff 4000->1400, +Delay, Bass +4 notes"). Two-voice color extends across history.
- **AI superpowers:** plain-language version summaries, bisect the edit that made it muddy,
  time-travel debugging for music.

Keep edit-time (vertical, history) visually distinct from play-time (horizontal). History
is its own mode/overlay, not crammed onto the song ruler.

## 8. Data & deployment: local-first

Recommendation: **local-first, project = a git-friendly folder of human-readable files**
that is the source of truth, with an optional minimal server. This is the only model where
"edit in your IDE" and "git your project" are first-class rather than bolted-on, and it
matches the versioning direction in section 7. Server-based (Figma/Onshape) buys easy
collaboration but makes the files not-yours and turns IDE editing into an awkward
API/mount dance.

- **The web app, an in-app file viewer, and your own IDE are three editors over one synced
  folder.** A casual user never sees a file; a tinkerer lives in them; nobody is locked
  out. A file-watcher reloads disk changes into the store; app edits write back. Because
  every change flows through the same store and event log, all three stay in sync. ("App +
  IDE + agent editing one synced document" is the genuinely novel story, and it is how the
  project is already being developed.)
- **A file viewer panel in the app** (power-user view, collapsed by default) shows the
  project tree, allows inline edits, and offers "open folder in your IDE."

Honest constraints:

- **Browser filesystem access is limited.** The File System Access API (directory handles,
  read/write) is Chromium-only and permission-gated; Safari/Firefox barely support it. The
  robust "just point your tools at the folder" experience really wants a **desktop shell
  (Tauri)** for full filesystem + native audio. Reasonable path: start web with the FS API,
  graduate to a Tauri desktop build for the power workflow.
- **A thin server still earns its place** even local-first: to hold/proxy the AI API key
  (never ship it in the client) and, later, for sharing/collab/backup. It is optional
  infrastructure, not the home of the data - the git "local repo + optional remote" model.

## 9. The agent: pluggable, not either/or

The MCP tool surface is just a set of tools over the store. What drives them is
interchangeable:

- **In-app agent** - the Claude API with the same operations exposed as tool-use functions.
  This makes "agent front and center" real for a general user who just opens the app, no
  install. Build this; it is the product.
- **Claude Code over MCP** (today's setup) - keep it. Perfect for the developer/tinkerer
  audience driving the same tools from a terminal or scripts.

So: own in-app agent **and** the MCP server, sharing one tool/store layer. We do not build a
bespoke agent from scratch; we reuse the tools and let the model reason, on the latest models.
Concretely: the agent **loop runs client-side** - tool calls execute in the browser through
the same `dispatch` seam (authored `claude`, coral in the feed) - and **one shared tool
catalog** (zod -> JSON Schema) feeds both the MCP server and the panel. The thin server is
only a **key-proxy**: keep it **provider-agnostic** (an OpenAI-compatible base URL + model, so
a free tier or a local model can drive tests; default Claude Sonnet), and keep the key
**server-side only** - spend-capped, never `VITE_`-inlined into the client, with auth +
rate-limiting before any non-localhost deploy. The agent reasons on symbolic data and cannot
hear its output; **audio-analysis tools** give it "ears" (see the roadmap).

Note: Claude Code / Claude Desktop over MCP already gives a capable agent on your existing
subscription (no per-token API key) - the in-app panel adds the embedded UX and reaches the
general "just open the app" user.

## 10. Proposed on-disk project format (the concrete next step)

Everything tinker-related (file viewer, IDE editing, git history, import/export, sharing)
depends on the serialization format, and we are about to define persistence/versioning
anyway. So the high-leverage move now is to design this deliberately: human-readable,
diffable, interoperable.

```
my-track/
  project.json        # tree of buses, tempo, lengthBeats, arrangement, selection, refs
  tracks/
    lead.json         # { instrumentType, params (patch), effects: [{type, bypassed, params}] }
  clips/
    lead-arpB.mid     # standard MIDI so any tool can read it (or .json for our note model)
  automation/
    lead-cutoff.json  # { paramRef, breakpoints: [{beat, value, curve}] }
  variants/
    lead-arpB/        # a clip's variant stack: each a notes + patch + chain snapshot
  samples/
    kick.wav          # referenced by path from tracks/clips
  .git/               # history, branches, versions - for free
```

Notes:

- Project structure, patches, automation, variants -> stable, sorted JSON (diffable).
- MIDI -> standard `.mid` for interoperability; audio -> `.wav`/`.flac` referenced by path.
- An instrument _preset_ is just its `PatchValues` (a param snapshot); an instrument
  _definition_ (the DSP) is app code today. Custom-DSP-via-worklet later could let users
  drop in their own instrument code - the ultimate tinker story, far off.
- Keep ids stable and human-meaningful where possible so diffs read well.

## 11. Roadmap / slicing

Done: slice 1 (param schema + subtractive synth), 2 (MCP server), 3 (piano roll + playback +
persistence), 4 (multi-track + instrument abstraction + FM), 5 (effect chains + shared
`bindParams` seam + master limiter), 6 (app-shell relayout in Tailwind: video-editor spine,
agent pane, library tree; conventions pass - zod validation, map dispatch, catalog-driven),
7 (data-model spine: project as a tree of buses / grouping - see section 4 - with group
effect chains, the librarian filing tracks into family groups, group-addressed MCP tools,
and host-addressed effects), 8 (audio tracks + audio clips: Track is a discriminated union of
instrument|audio, OPFS-backed clip storage, file import + AudioBufferSourceNode playback
through the bus tree - see section 14), 9 (authored edit log: every durable edit flows through
one `dispatch(command, author)` seam into an append-only, authored command log, sharing the
MCP protocol's command vocabulary - powering undo/redo and the two-voice activity feed),
10 (clip variants: an instrument track owns a stack of variants, each bundling clip notes +
instrument params + effect chain; the active variant is materialized into the live stores in
place so the engine bindings survive; "Try"/fork is non-destructive, switching morphs the
devices, and Claude's generated takes are tagged coral - see section 6),
11 (edit-log persistence: the authored command log is persisted alongside the project
snapshot in localStorage and restored on load, so the activity feed and authored history
survive a reload; undo/redo stays session-scoped),
12 (piano-roll editing: full mouse manipulation - drag-move, edge-resize, marquee
multi-select + multi-delete, velocity lane, copy/cut/paste - plus zoom, a bar/beat ruler, and
a draggable loop-length handle; new plural clip commands (`addNotes`/`editNotes`/`removeNotes`)
make each gesture one feed entry and one undo step - and fix the `add_notes` history spam - and
a project-level `setLength`; the shared `beats<->px` ruler/zoom primitive
(`src/ui/timeline/`) is built here for the arrangement timeline to reuse - first of three
"real DAW" pieces. A second commit adds polish: a real **loop region** [loopStart, loopEnd]
that the scheduler loops (project `loopStart` + `setLoopStart`, two ruler handles, grid drawn
past the end to scroll/expand into), fit-notes-to-window on track load, pinch / Cmd-scroll /
Shift-scroll zoom, narrower velocity bars + a resizable velocity lane, deselect on Escape /
click-outside, and a workbench relayout - variants moved to a left rail beside the roll, with a
resizable device|roll divider and a wrapping instrument/effects rack),
13 (arrangement clip model + editable timeline - the second & third "real DAW" pieces: a track
now owns a **pool of clips** (each its own ClipStore) and an **arrangement of placements**
{clipId, startBeat, offset, length} along time; track-level sound (params + effect chain), so a
clip is just notes; the scheduler flattens placements -> events and **tiles a clip when its
window outruns it** (drag-out loop), with audio re-triggered per clip-length. The bottom
timeline became editable: place / select / move / resize / split / delete placements, copy /
cut / paste, drag a clip from the rail onto its lane, a bar/beat ruler owning the loop region,
time zoom + snap, a sticky-header spreadsheet scroll, inline rename of tracks / groups / clips,
and "+ Clip" / lane edits create empty clips. Persistence bumped to v7 with a v6-variant
migration (one clip per variant, sound from the active variant). The top toolbar was removed -
transport moved to the arrangement header, undo/redo to the activity panel, the brand to the
library),
14 (clip launching - mode-less Session: a persisted per-track `launchedClipId` that loops over
the transport and **overrides** that track's placements, so a track can loop a clip without
dragging it across the timeline. Launch from the clip rail (auto-starts the transport); the
lane greys with a "now playing" badge and the arrangement header shows a **Clip mode / Back to
timeline** control that stops all launched clips. The scheduler treats a launched clip as one
full-region placement (reusing the loop tiling); the state flows through the same dispatch/MCP
seam (`launch_clip` / `stop_all_clips`), so it is undoable, in the feed, two-voice, and saved -
no separate Session *mode/view*, just a visible override state. Also adds clip copy/paste in the
rail (Cmd/Ctrl C/X/V on the focused rail, like the timeline's placement copy/paste): a
`pasteClip` command carries kind-tagged clip content through a module clipboard, so clips copy
within a track and **across same-kind tracks** - audio reuses the source OPFS file; cross-type
paste is refused. Keyboard routing is by DOM focus, so the rail, timeline, and roll each own
their own copy/paste).

Sequencing follows the thesis (section 1: structured, authored events in one store). The
**authored edit log** (slice 9), **clip variants** (slice 10), **log persistence** (slice 11),
the **arrangement clip model + editable timeline** (slice 13: a track owns a pool of clips
arranged as positioned placements, with linear editing and copy-paste), and **mode-less clip
launching** (slice 14: a persisted per-track launched clip that loops over the transport,
overriding placements) are in place. The remaining piece in this theme is the optional
multi-track **Session grid view** + scenes on top of the same launched-clip model (one model,
two views); it is now a view, not a model change. The raw backlog below is grouped into themed
slices; within a theme, order is rough.

**Near-term - UI on top of the current model**

- **Group/track selection + group-FX editing in the workbench** (next, small). Select a
  group or track and edit its effect rack in the center workbench; generalize selection
  beyond "the selected track". Model/audio/MCP already support group effects (host-addressed).
- **Transport & grid:** time signature, metronome, timeline beat markers. Foundational for
  everything rhythmic; small and transport-level.
- **Piano-roll editing - DONE (slice 12), the first of three "real DAW" pieces.** Full mouse
  manipulation on the existing single-clip model (no schema change): drag-move, edge-resize,
  marquee multi-select + multi-delete, a velocity lane, copy/cut/paste, horizontal/vertical
  zoom, a bar/beat ruler, and a draggable loop-length handle (project-level `setLength`). Plural
  clip commands (`addNotes`/`editNotes`/`removeNotes`) make each gesture one feed entry + one
  undo step (and fixed the per-note `add_notes` history spam); they extend the MCP vocabulary
  too (`edit_notes`/`remove_notes`/`set_length`/`set_loop_start`). The shared **beats<->px +
  zoom + ruler** primitive (`src/ui/timeline/`) is in place for the arrangement timeline to
  reuse. A polish pass added a real **loop region** [loopStart, loopEnd] the scheduler loops
  (two ruler handles; grid drawn past the end), fit-to-window on load, pinch / modifier-scroll
  zoom, a resizable velocity lane, deselect on Escape / click-out, and a workbench relayout
  (variants in a left rail, resizable device|roll divider, wrapping rack). *Musical editing
  follow-ups below (quantize/groove, project key) still pending.*
- **Musical editing:** quantization + grooves (strength, swing, groove templates), and a
  project key with the roll showing note intervals/scale relative to it.
- **Timeline & arrangement interactions - DONE (slice 13 + follow-ups), the third "real DAW"
  piece.** The bottom timeline is editable: zoom + scroll (reusing the piano-roll's
  beats<->px+ruler primitive), move / resize / split / delete placements, drag empty lane to
  create a clip, copy-cut-paste, snap-to-grid, and a ruler owning the loop region. Follow-ups
  added: clicking a lane drops a **paste marker** (copy/paste lands there), dragging a clip from
  the rail places it onto **any same-kind track** (copying it into that track's pool), a **"+"
  add-effect menu** at the end of the chain, and **Space** toggles the transport from anywhere.
  *Still pending in this theme (model-independent):* track reorder by drag, track-height resize,
  track colors, a richer visual summary of grouped tracks, split-at-playhead, and **library
  drag-and-drop** - dragging an instrument/effect from the library onto the track edit panel
  (the add-effect menu covers the quick path; full DnD, incl. instrument-on-track semantics, is
  the larger item).
- **Activity feed at scale.** The feed already caps the rendered list at 100; for very long
  sessions, **virtualize / paginate** the history (and consider truncating or chunking the
  persisted log) so it stays smooth.

**Model evolutions - sequence early, they unlock the rest**

- **Authored edit log + persistence - DONE (slices 9, 11).** Every durable edit flows through
  one `dispatch(command, author)` seam into an append-only, authored command log, powering
  undo/redo (snapshot checkpoints with coalescing) and the two-voice activity feed; the log is
  persisted alongside the project snapshot (localStorage) and restored on load, so the feed and
  authored history survive a reload (undo/redo stays session-scoped). *Remaining:* **version
  history** with replay/scrub/rollback and semantic diff/merge & branches (section 7) - which
  needs undo to append compensating entries so the log becomes a faithful event source - and
  graduating storage from localStorage to the on-disk file format (section 10) / IndexedDB.
- **On-disk file format** (section 10): human-readable project files; pairs with the persisted
  edit log and local-first storage.
- **Clip variants - DONE (slice 10).** An instrument track owns a stack of variants; each
  **variant bundles clip notes + instrument params + effect chain** (section 6), so switching
  morphs the devices too. "Try"/fork is non-destructive (the original is parked); Claude
  generates takes tagged coral; switching/forking loads a variant into the live stores in
  place so the engine bindings survive. Edits flow through the same `dispatch`/MCP seam, so
  undo/redo and the activity feed cover them. Slice 13 superseded the variant *stack* with a
  track-level sound + a **pool of clips** (see below); the v6 variant format migrates to it.
  Slice 14 then added **mode-less clip launching** (a persisted launched clip loops over the
  transport, overriding the track's placements - launchable slots without a separate view).
  *Remaining:* the optional multi-track **Session grid view** + scenes on the same model (each
  track a column of its clips, scenes launching a row across tracks) - a view, not a model
  change.
- **Arrangement clip model - DONE (slice 13), the fundamental / second "real DAW" piece.** A
  track now owns a **pool of clips** (each its own ClipStore) and an **arrangement of
  placements** {clipId, startBeat, offset, length} along time; the sound (instrument params +
  effect chain) is track-level, so a clip is just notes. The scheduler flattens placements ->
  events and tiles a clip whose window outruns it (drag-out loop); audio re-triggers per
  clip-length. This rippled through the command vocabulary, MCP tools, and persistence (v7 +
  v6-variant migration: one clip per variant, sound from the active variant). This unlocked the
  timeline interactions above; MIDI import as clips and the Session/Grid view ride on the same
  model.
- **Full DSP** via AudioWorklet (the `bindParams` seam already isolates native -> worklet:
  per-voice filter, worklet param messaging). Once it lands, **audio time-stretch** (speed
  up/down without changing pitch) and other sample-accurate audio work become tractable.

**Recording & input**

- **Live audio capture** (section 14): getUserMedia + worklet/MediaRecorder, recording
  latency compensation, calibration.
- **MIDI device input + recording** via the Web MIDI API: capture played notes into a clip;
  reuses the same arm / record / quantize machinery as audio.

**Instruments, content & ecosystem**

- **Sampler instrument:** plays an audio buffer chromatically - a natural bridge between the
  instrument catalog and the slice-8 audio-clip storage.
- **Open-source instrument & effects library:** grow the catalogs, possibly a shareable /
  community device format (open question).
- **In-app IDE / user-authored components.** An embedded editor (Monaco / CodeMirror) for
  **custom instruments/effects via AudioWorklet** - declared by a param schema, so UI, MCP,
  automation, and persistence come for free (the catalog/registry are already the extension
  point, game-engine style) - plus generative **scripts** over the `dispatch` API, alongside
  the in-app file viewer (section 8). Pairs with the shareable/community device format; running
  user code needs **sandboxing + a trust model** (resource limits, Worker/iframe isolation,
  capability-limited APIs) before any sharing, and the agent can author components too. Builds
  on the "custom-DSP-via-worklet" note in section 10; the fullest workflow wants the Tauri
  shell + local-first files (sections 8, 10).

**Agent**

- **In-app agent panel** (section 9): an embedded chat driving the model via the client-side
  tool loop + thin, provider-agnostic key-proxy described in section 9. Reuses the one shared
  tool catalog (zod -> JSON Schema); edits land authored `claude` (coral) through the existing
  `dispatch` seam. Claude Code / Desktop over MCP already covers this for the tinkerer at no
  per-token cost; the panel adds the embedded UX and the general "just open the app" user.
- **Agent "ears" (audio analysis).** The agent reasons on symbolic data and cannot hear the
  output. Render offline (`OfflineAudioContext`) and expose **analysis tools** that mirror the
  `list_*` reads: objective DSP first (loudness / LUFS, spectral balance / masking, clipping -
  e.g. Meyda), then MIR (key / BPM / onset via essentia.js), then perceptual/semantic (CLAP or
  an audio-tagging model, or a multimodal model as a `describe_sound` tool). Closes the
  perception loop for mixing/arrangement; human auditioning still decides taste.

**Platform & form factor**

- **Mobile / responsive layout.** The four-region video-editor grid (library | center | agent
  + timeline) assumes a wide screen; small screens need a different shape - collapse to a
  single focused region with a bottom tab/drawer bar to switch between library, the selected
  track's workbench, the timeline, and the agent. Touch interactions are the real work: the
  knob's vertical-drag gesture, note drawing, and group/clip drag all need touch handlers and
  larger hit targets. The agent pane leans toward a slide-over sheet on phones. Being web-first
  is the advantage here - it should run on a tablet/phone, which also makes the AI-co-author
  pitch (hand it to Claude, glance at the feed) compelling on the go. Mode toggle
  (Converse/Produce) maps naturally onto how much screen the agent takes.

**Longer horizon:** automation lanes (section 5); sharing / collaboration; Tauri desktop
shell (also the home for native low-latency monitoring and the fullest in-app IDE workflow).

The cheap things to bake in early (because retrofitting is expensive): the project as a
nested tree of buses, a persisted append-only authored event log, clip variants as bundles
of snapshots, and the human-readable file format.

## 12. Open decisions (deferred, not blocking)

- Web-only-with-FS-API vs Tauri desktop, and when to make the jump.
- Bus-tree grouping vs also modelling song sections as a hierarchy (current lean: bus tree
  structural, sections on the timeline).
- How prominent the conversation is by default (status strip -> dock -> co-equal panel).
- In-app agent hosting: client-side with a server key-proxy vs more server-side reasoning.

## 13. Reference

- Wireframe (iterated v1 -> v5) as a Claude artifact: the video-editor spine, agent-right,
  two-voice color, grouping, clip variants, library tree, open timeline, panel hierarchy.
  (Private artifact link from the design session.)
- Memory pointer: `web-daw-ui-direction` (concise recall) points here for the full version.

## 14. Live audio recording & input (design thinking)

The honest constraint first: the browser cannot reach ASIO-class round-trip latency. On
Windows the browser drives audio through WASAPI (usually shared mode), never ASIO, and
there is no web API to reach an ASIO driver. macOS/CoreAudio is decent; Windows is mediocre.
So the strategy is not "beat the latency" - it is "don't depend on it for tracking, and null
it out for timing accuracy." That is also how pros track in any DAW once buffers get large.

The capture path (web-first):

- **Input** via `getUserMedia({ audio: { deviceId, echoCancellation:false, noiseSuppression:
false, autoGainControl:false, channelCount, sampleRate } })`. Disabling the voice-DSP is
  mandatory or Chrome mangles the signal. Enumerate/select interfaces with
  `enumerateDevices()` (labels need permission; HTTPS/secure-context required).
- **Into the graph** via `MediaStreamAudioSourceNode`, then a capture **AudioWorklet** (the
  ScriptProcessor replacement) that runs on the render thread at 128-frame quanta and copies
  PCM into a **SharedArrayBuffer ring buffer** (needs cross-origin isolation: COOP/COEP
  headers). A Web Worker drains the ring and streams float32 to **OPFS / File System Access
  API** (and/or encodes WAV/FLAC via WebCodecs), so we never hold gigabytes in RAM.
- **Sample-rate alignment:** run the `AudioContext` at the interface's native rate (request
  48k, read back `sampleRate`); resampling a getUserMedia stream adds latency and artifacts.

Monitoring (what the performer hears while recording):

- **Hardware/direct monitoring is the default recommendation** - the interface mixes input
  to output internally, zero added latency, the computer only captures. This sidesteps the
  whole latency problem for tracking and is what ASIO users do anyway when buffers are big.
- **Software monitoring** (through our graph) is offered only where the round-trip is low
  enough (macOS + good interface); we read `context.outputLatency`/`baseLatency` and warn.

Timing accuracy = **recording latency compensation** (the real answer):

- We don't need low latency to record _accurately_; we need to know the offset and shift the
  recorded region back by it so it lands where the performer actually played. Captured frames
  are timestamped against `context.currentTime`; the round-trip offset = input + output +
  worklet buffering.
- A one-time **loopback calibration** (play a click, record it back through a physical/virtual
  loop, measure the sample offset) gives an exact per-device compensation value - Logic/Ableton
  call this driver-error compensation. Store the offset on the recorded region; everything
  downstream stays sample-accurate.

Fit with the model:

- A **recorded clip is just another clip type** alongside MIDI/note clips: a reference to an
  audio buffer (OPFS file) + the compensation offset, sitting on an **audio track** whose
  "instrument" is a buffer player. It flows through the same ProjectStore/persistence/MCP
  keystone; playback schedules `AudioBufferSourceNode.start(when)` via the existing lookahead
  scheduler (playback latency is bounded by `outputLatency` and is fine for non-interactive
  playback).
- MCP stays a control-plane: it can arm/disarm tracks, start/stop capture, set the
  compensation, and place/trim recorded regions - never the realtime sample path.

The escape hatch for true low-latency monitored tracking: the **Tauri desktop backend**
(already an open decision). A Rust audio backend (CPAL, or WASAPI-exclusive / CoreAudio, even
ASIO) could own capture/monitoring natively while the same web UI/model rides on top. Staged
plan: web-first with hardware monitoring + latency compensation (covers most recording), then
the native backend for users who need monitored low-latency input.
