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

**Decided (v1, slice 15):** versioning is **hybrid** - working edits autosave continuously
(never lose work), the system **auto-checkpoints** on a cadence, and you or Claude can stamp a
**named version**. The **semantic edit DAG is the source of truth**; the materialized
`project.json` snapshot is a fast-load cache, always rebuildable by replaying commits. We keep
our **own** content-addressed commit DAG rather than binding to real git: git's text-merge buys
nothing for music, and our edits are already semantic, so we get readable diffs for free.
Exporting to / backing onto git stays an option for a later slice (the "PR your arrangement"
story), not a v1 dependency. Undo/redo graduates from session-only to **time-travel over
commits** (survives reload). Branches, revert, cherry-pick, and remote sync are the slices
after (see slice 15C+ in the roadmap).

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

**Decided (v1) bundle layout.** The tree above is the eventual *tinker/IDE* shape - one file
per track/clip so they diff and open in an editor. v1 keeps it simpler but **history-bearing**,
and identical across storage backends (OPFS now, a real disk folder later):

```
MyProject.daw/
  manifest.json        # formatVersion, project id, HEAD (current branch + uncommitted working edits)
  project.json         # materialized working snapshot (a fast-load cache of replay)
  history/
    commits/<id>.json  # { parents[], author, message, edits[], snapshotHash, time }
    refs.json          # branch -> headCommitId, tags
  samples/<sha256>.wav # content-addressed binary (dedup + integrity; replaces au-xxxx file ids)
  meta.json            # name, created/modified, tempo preview, authors
```

A `ProjectRepository` interface abstracts the backend (OPFS first; the File System Access API
for a real disk folder; remote later), so the same bundle logic serves local and remote, and
sync becomes git-like push/pull of missing content-addressed objects. The per-track file
explosion above (`tracks/*.json`, `clips/*.mid`) is a later refinement on top of this, once the
in-app file viewer / IDE-editing story (section 8) is built.

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

**Next up - persistence & version control (slice 15, planned).** Graduate from the single
localStorage blob to a **project bundle** and build **semantic version history** on the edit
log (sections 7, 8, 10). v1 is two commits; branches / disk-folder / remote follow:

- **15A - bundle format + repository (storage refactor, no UI change).** A `ProjectRepository`
  interface with an **OPFS bundle** backend (`manifest.json` + `project.json` + `history/` +
  content-addressed `samples/`). Move samples off ad-hoc `au-xxxx` OPFS files to **sha256
  content-addressing** (dedup + integrity). **Migrate** the existing v7 localStorage blob +
  OPFS samples into a bundle on first load (localStorage becomes a read-only fallback).
  Persistence gets its own `formatVersion`. Pure plumbing, verified headless - de-risks by
  separating storage from VCS semantics.
- **15B - commits & durable history.** Add the **commit DAG** to the bundle: working edits keep
  autosaving, the system **auto-checkpoints** on a cadence, and you/Claude **stamp named
  versions** (the hybrid model). Undo/redo becomes **time-travel over commits** (survives
  reload). A **semantic diff** between commits ("Lead cutoff 400->800, +4 notes") renders in
  two-voice color; the activity feed becomes a commit timeline. MCP gains `commit` /
  `list_history` / `diff` / `revert_to` (landed as a follow-on): the commit DAG lives in the tab
  (OPFS), so these tools use the one **request/reply** path on the bridge - the server sends a
  `historyRequest`, the bridge answers from the `VersionStore` with a `historyReply` (everything
  else is fire-and-forget). The semantic DAG is the source of truth; `project.json` is a replay
  cache. Also ships **export / import of a portable `.daw.zip`** - a plain zip of the *readable*
  bundle (pretty-printed `project.json` + `log.json` + `notes.json` + real `samples/*.wav`), so you can unzip
  and inspect a project. This is the **same folder the disk-folder backend (15D) writes
  uncompressed**, so export and on-disk are one format. It is the shareable, commit-able artifact
  that works *before* 15D, since today's bundle lives in OPFS (invisible to the filesystem). The
  controls live in a project menu to the left of the library title (with audio import).
- **15B-storage - keyframe + delta commits (landed as a follow-on).** Commits are stored like
  video frames: most hold only their `entries` (the semantic delta) and reconstruct on demand by
  replaying forward from the nearest ancestor that carries a full `snapshot` (a *keyframe*). A
  keyframe is written for the root, every Nth commit, a revert (a discontinuity), and **any
  commit containing undo/redo entries** - those restore a snapshot rather than applying forward,
  so they can't be replayed; forcing a keyframe there keeps every delta commit pure-forward and
  exactly replayable via the shared `applyEdit`. This makes a checkpoint cost the size of one
  edit-burst (~50-100x smaller than a full snapshot), so auto-checkpointing freely is cheap.
  `materialize(commitId)` does the reconstruction (used by `revertTo`/`diff`); `project.json`
  stays the O(1) working-state cache, so replay is only ever on the cold path. Audio was already
  content-addressed (shared across commits), so the bundle stays lean. The **persisted undo/redo
  stacks** (`undo.json`) use the same trick: instead of one full snapshot per checkpoint, each
  stack stores a single base snapshot + the command of each checkpoint, rebuilt on reload by
  replaying through `applyEdit` (the in-memory stacks stay full snapshots for instant undo) -
  ~24x smaller in practice. This required making `apply` a *pure function of the command*: the
  one hole was `createTrack` auto-creating a family group with a random id, now derived
  deterministically from the family name. *Still pending: sample GC (drop `samples/*`
  unreferenced by any commit or the working project) and including the `history/` DAG in the
  `.daw.zip` export.*

The follow-on slices (not in this push): **15C** branches + revert + cherry-pick (the "Claude
tries an arrangement on a branch, you compare and merge" workflow), **15D** a real disk folder
via the File System Access API (+ optional git export), **15E** remote sync / collaboration.

**Extension SDK - third-party instruments & effects (ecosystem + ownership)**

The project is licensed **AGPL-3.0** (strong copyleft so a modified core can't be closed and
hosted as a rival), with the option for the copyright holder to dual-license commercially. The
intended growth model is **extension, not modification**: people add instruments and effects
without touching the core, so ownership of each piece is clear - the core stays a single-owner,
dual-licensable unit; each extension is owned by its author under the license they choose. That
shape is already latent in the design: the catalogs + registries are *the* single extension
points (`audio/instruments/catalog.ts`, `audio/effects/catalog.ts`, `registry.ts`), and because
the parameter schema is the keystone, a registered instrument shows up in the UI, the MCP
palette, automation, and persistence for free.

To make that extension point *external*:

- **Promote the static catalogs to a registration API - DONE.** The catalogs and factory tables
  are now Map-backed registries: `registerInstrument({ type, label, family, schema })` +
  `registerInstrumentFactory(type, factory)` (and the effect equivalents), with built-ins
  self-registering at module load. Adding one needs no edit to any central object or switch -
  proven by the **Chorus** effect, added purely through the API. The split is preserved so the
  Node MCP server stays DOM-free: the *data* half registers in `catalog.ts` (schema, label,
  family - what the server imports), the *audio factory* half in `registry.ts` (Web Audio).
  Consumers iterate `instrumentInfos()` / `effectInfos()` and test membership with
  `hasInstrument()` / `hasEffect()`. (Runtime registration trades the old compile-time "every
  cataloged type has a factory" check for external extensibility.)
- **Carve out a small permissive SDK package** (e.g. `web-daw-sdk`, MIT/Apache) holding only the
  stable contract a plugin imports: the param-spec types, the `specToZod` derivation
  (`params/zod.ts`), the instrument/effect definition interfaces, and the pure-`Float32Array`
  worklet/DSP contract. Plugins depend on the SDK, not the AGPL core, so they are **not** forced
  to be AGPL - that is what keeps the ecosystem open (incl. closed or differently-licensed
  extensions) while the core stays protected. (Alternative: keep one repo and add a GPL linking
  exception scoped to the plugin interface; the SDK split is cleaner and forces a good boundary.)
- **Loading model:** for self-hosters, extensions are npm packages imported at build (the data
  half imported by the server too, so it can validate the plugin's params); a runtime plugin
  loader / marketplace - which also needs the plugin's schema synced to the server process - is a
  later step (and a natural commercial surface).

The SDK surface becomes the thing we promise not to break; everything behind it stays free to
refactor. Shipping the AGPL license now is independent of this - the SDK carve-out is additive.

*Distribution models (how a user installs an extension).* The registration API is deliberately
**loader-agnostic** - it only cares that something calls `registerInstrument`/`registerEffect` +
the factory, not how the code arrived - so these are loading + trust layers on the same seam, not
separate architectures. The shaping fact: an extension here is **executable JS** (+ optional
AudioWorklet / Wasm), not a native binary, so for the dynamic tiers the hard part is *trust*
(running third-party code in the page origin), not the mechanics. Tiers, easiest to hardest:

- **In-code (build-time) - available now.** The extension is an npm package whose import makes
  the register calls; the bundler includes it. For self-hosters who build. No dynamic loading,
  no trust problem.
- **By-name remote, version-pinned (like a GH Actions `uses:`).** A resolver maps a name+version
  to an artifact (npm/CDN/own registry); the app `import()`s the ES module and calls
  `audioWorklet.addModule(url)` for DSP. Reuses the sha256 content-addressing already used for
  samples to pin/verify a version. Needs CORS/CSP config + the dynamic-load path.
- **Store UI.** The above plus discovery and **curation** - and curation doubles as the trust
  model (reviewed extensions). The natural commercial surface.
- **Drop-in folder (game-mod style).** Cleanest in the **desktop/Tauri build** (a real
  `plugins/` folder the shell loads), which fits the local-first 15D direction. Possible in a
  pure browser tab via the File System Access API + dynamic import, but with the same
  origin-trust caveat.

Two properties of the current design help the dynamic tiers: the **data/code split** lets the
server receive a plugin's *schema* (plain JSON) for param validation without running its code;
and the **schema-as-keystone** model means the more behaviour lives in the declarative schema
(and DSP in sandboxable Wasm), the harder the factory can be sandboxed. Trust options for the
dynamic tiers: curation, sandboxing (worker/iframe/Wasm with a narrow capability surface), or
"power users accept the risk."

**Near-term - UI on top of the current model**

- **UI tidy-ups (batch, slices 25-26 + follow-ons).** A pass of small/medium polish, several
  sharing three reusable primitives built once and reused (an editable/truncating **title**, a
  kebab **context menu**, and a **draggable resize area**, alongside the existing `ResizeHandle`):
  - *Editable title everywhere* - one component for inline-rename + truncate-with-full-title-on-hover,
    applied to track / instrument / effect / clip names (consolidates `InlineRename`). **[foundational]**
  - *Kebab (⋮) context menus - DONE (slice 26).* A reusable icon-only `Menu` ([ui/Menu.tsx](src/ui/Menu.tsx))
    replaces the track/group/patch × and the "+ Group" button: rows get Delete (Duplicate later), the add
    menu offers Add empty track / Add group. The popover renders in a **portal** (fixed-positioned) so it is
    never clipped by a row's overflow or painted over by a sibling row's controls, and only one menu is open
    at a time. **[foundational]**
  - *BUG: context-menu popover can open offscreen.* `Menu` positions its portal popover at `top:
    trigger.bottom + 4` with no viewport clamp, so a trigger near the bottom edge (e.g. the last track's ⋮)
    opens a menu that runs off the bottom; same for the right edge. Fix: measure the popover and flip
    above / clamp inside the viewport when it would overflow (in [ui/Menu.tsx](src/ui/Menu.tsx)).
  - *Timeline resize handle vs loop markers - DONE (slice 26).* The bottom-timeline resize handle straddled
    the panel's top edge and stole drags from the ruler's loop-region markers; it now sits fully above the edge.
  - *Clip-rail width drag-resize - DONE.* The clip pool beside the piano roll is now drag-resizable
    (persisted width via the shared `ResizeHandle`), like the device rack and side panels.
  - *Per-track timeline row height (deferred to its own slice)* - confirmed **per-track** (each lane its own
    height + bottom-edge handle, persisted by track id), not a uniform lane height. Not a plain `ResizeHandle`
    reuse: the arrangement bakes a fixed `ROW_PX` into its lane layout (`contentH = RULER_H + rows.length *
    ROW_PX`), placement offsets, playhead, and ruler math, so variable row heights ripple through all of that.
    **[foundational]**
  - *Resize handles: keep `ResizeHandle`, don't build a heavyweight `ResizableBox`.* The pointer-drag/axis/
    body-cursor primitive (`ResizeHandle`) is the right shared layer; what sits above it (where the size lives,
    grid offset vs flex child vs scroll-anchored divider, persistence) genuinely differs per site, so one box
    would accrete props. Low-hanging cleanup instead: fold the arrangement header-column divider (still bespoke)
    onto `ResizeHandle`, and optionally extract a tiny `useResizable` hook pairing `usePersistentNumber` with the
    `clientPos - rect.left/top` math that repeats across the workbench handles.
  - *Clip delete always available* - show the × even on the last clip; deleting the last one replaces
    it with a fresh empty clip (ids minted in the UI, so replay stays deterministic).
  - *Feed: committed vs uncommitted styling* - drop the separate "autosaved" marker; render committed
    entries as normal white text and uncommitted ones greyed/italic, "saved" on hover (compare entry
    seq to the latest commit's `lastSeq`).
  - *Feed: group same-device edits* - collapse consecutive param edits on one instrument/effect into a
    single grouped row to save space (display-only; distinct from edit coalescing).
  - *Remove the instrument family chip* in the library (added then judged unnecessary).
  - *Selected track-header opacity* - a selected track header used a translucent tint, letting the
    lane's clip notes bleed through the sticky header column; use an opaque teal-tinted panel color.
  - *Master gain* - a project-level master gain (the engine already has the master `GainNode`); a slider
    in the timeline's top-left above the track headers, plus model/persistence (+ MCP).
  - *Library drag-and-drop (feature, own slice)* - drag an instrument / patch / effect onto a track, the
    empty lane area, or the instrument slot to create (or replace) a track's device, with a confirm
    dialog when replacing an existing instrument + effects.
- **Group/track selection + group-FX editing in the workbench** (next, small). Select a
  group or track and edit its effect rack in the center workbench; generalize selection
  beyond "the selected track". Model/audio/MCP already support group effects (host-addressed).
- **Patches (instrument presets) - DONE (slice 24).** Save an instrument track's
  sound - its instrument type, parameter values, and effect chain - as a named **patch**
  in the library tree, then add a new track from it like a built-in instrument. Patches are
  **global** (cross-project), so they live in localStorage (`src/audio/patches/library.ts`),
  not the project bundle. Applying one is a single authored `createTrackFromPatch` edit that
  carries pre-minted effect ids, so it is undoable, two-voice, and replay-deterministic like
  any other; `ProjectStore.addTrackFromPatch` loads the values through the same coercing
  setters. The library tree restructured to a collapsible **Instruments** section that lists the
  catalog (each leaf chipped with its `family` - Synths / Bass / Keys - iterated, not hardcoded)
  with a nested **Patches** sub-section, and an **Effects** section beside it. **MCP patch tools**
  let Claude drive the library too - `list_patches` / `save_patch` / `apply_patch` ride a
  `patchRequest`/`patchReply` RPC (the same shape as the history RPC, since patches live in the
  tab's localStorage): `save` captures a track's live sound authored `claude`, `apply` dispatches
  a `createTrackFromPatch` edit (coral, undoable). Patch row dots are two-voice colored by author.
- **Transport & grid:** time signature, metronome, timeline beat markers. Foundational for
  everything rhythmic; small and transport-level.
- **Mixer controls.** Track + group headers carry an adjoined **Mute/Solo** group (solo is a
  per-track/group flag; the engine silences anything not solo-active - see `engine/mix.ts`) and a
  low-profile **fader** (a line with a triangle ticker; `ui/MixerControls.tsx`). *Pending:* a
  **live level meter** overlaid on the fader (red when clipping) - the `Fader` already accepts
  `level`/`clip`; needs per-bus metering in the `AudioEngine` (AnalyserNodes) + a rAF read loop.
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
  authored history survive a reload (undo/redo stays session-scoped). *Remaining -> now slice
  15:* **version history** with replay/scrub/rollback and semantic diff/merge & branches
  (section 7), and graduating storage from localStorage to the on-disk bundle format
  (section 10). See the slice 15 spec above.
- **On-disk file format** (section 10): human-readable project files; pairs with the persisted
  edit log and local-first storage. The v1 bundle lands in slice 15A; the per-track-file
  *tinker/IDE* shape is a later refinement (section 8).
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

- **Metronome - DONE (slice 27).** Engine `scheduleClick`, scheduler emits whole-beat clicks in
  the lookahead window (bar accent follows the loop), transport toggle. A transient preference,
  not an edit.
- **Live audio capture - core DONE (slice 28).** getUserMedia (voice DSP off) -> capture
  AudioWorklet (`public/capture-worklet.js`, per-quantum float32 via postMessage, no
  SharedArrayBuffer) -> WAV (`recording/wav.ts`) -> `putAudio` hash -> one `addAudioTrack` edit
  (so persistence/replay match import; capture is a side effect, the edit is pure data). A
  `Recorder` controller holds the transient arm/record state; count-in (0/1/2 bars) pre-rolls
  metronome clicks before capture. Latency is a fixed `outputLatency+baseLatency` estimate
  baked into the take's start beat. Monitoring is hardware/direct (input is never routed to
  output). Records into a NEW audio track from the loop start.
- **Recording follow-ups (slice C / later):** MCP arm/record tools, input level meter, remembered
  device + eager enumeration, software-monitoring option, loopback **latency calibration**
  (store the offset on the region), punch-in at the playhead, arm an existing track, stereo.
- **MIDI device input + recording** via the Web MIDI API: capture played notes into a clip;
  reuses the same arm / record / quantize machinery as audio.

**Instruments, content & ecosystem**

- **MIDI effects (arpeggiator, octavator)** - a third device class on the note path, transforming
  notes before the instrument. Cataloged + schema-driven + per-track chain like audio effects;
  pure `(notes, range, ctx)` transforms run in the scheduler. Full design in section 15.
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
- **Two surfaces, one differentiator - the activity panel.** Whether the chat lives in Claude
  Desktop / Code over MCP (today) or the embedded panel (later), the genuinely novel surface is
  the activity feed itself: a shared, two-voice timeline of the *edits* and the agent's *stated
  intent*, not a chat log. Treat Desktop/Code-over-MCP as a first-class *supported* workflow, not
  just a dev convenience - it is the best demo, costs nothing per token, and self-selects
  technical early adopters for the richest feedback. Its limits are exactly why the embedded panel
  still matters: two windows breaks creative flow, and MCP setup is a non-starter for a general
  user. So MCP-in-a-second-window is the prototype + power workflow; the embedded panel is the
  consumer shape; both ride the same `dispatch` seam and the same feed.
- **Persist agent intent into history - DONE.** The agent's intent notes (the `note` feed
  annotations) used to be session-only and vanished on reload. They now persist two ways, both
  mirroring how edit `entries` already work: (1) the **working stream** rides along in the bundle
  as a parallel `notes.json` (and in the `.daw.zip` export), restored on load so the feed comes
  back; (2) on commit, the **uncommitted notes are swept into the commit** (`Commit.notes`, by
  seq range), so the version timeline reads as a narrated changelog and an exported project is
  self-contained. A note alone never creates a commit (it is not an edit); it rides into the next
  real commit. Crucially they stay **out of the replayable edit stream** - `materialize`/
  `applyEdit` never touch notes, so replay is still edits-only and exact. Autosave also subscribes
  to the edit log now, so a note posted with no following edit is still saved. The Versions tab
  shows a commit's notes on expand (a coral count glyph when collapsed). No format-version bump:
  an absent `notes.json` loads as `[]`, so older bundles are unaffected.
- **Play an idea to the agent (notes as a prompt modality).** The DAW's native language is
  notes, so let the user *perform* a short MIDI phrase and attach it to a message rather than
  describe it in words: "add this idea to the organ track", "make a breakdown that goes like
  this", "harmonize this", "continue this for 8 bars". The agent already speaks this vocabulary
  (`addNotes`/`editNotes`, pitches + beats), so an attached phrase is structured input it can
  transpose to key, quantize, harmonize, voice as chords, or place as a new clip/section, then
  narrate the why in the feed. Capture paths: an **idea/scratch capture** in the agent panel
  (arm, then play the on-screen keyboard or a Web MIDI device into a scratch buffer), or select
  existing notes / a clip and **"send to agent"**. A lightweight version already works over MCP:
  play into a scratch clip, then ask Claude to read it (`list_notes`) and act. This pairs with
  the agent's **"ears"** as the mirror image: notes-in as the prompt, audio-analysis-out as the
  feedback, so the loop becomes play-an-idea -> agent develops it -> you hear it and keep or
  reject. On-thesis: it makes the keystone note vocabulary an input modality for the agent,
  reusing the exact shapes already flowing through `dispatch`/MCP.

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
- Whether agent edits ever gate behind a propose / preview / accept step, or always land-then-
  undo (current model). The activity panel is already halfway to a propose/accept loop; land-
  then-undo keeps creative flow, but a gate may build trust for large or destructive batches.

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

## 15. MIDI effects (design thinking)

A **MIDI effect** transforms the stream of note events *before* it reaches the instrument -
the symmetric counterpart to an audio effect, which transforms the signal *after*. First
targets: an **arpeggiator** (turn held/overlapping notes into a rhythmic sequence) and an
**octavator** (double each note up/down one or more octaves). They are not instruments and not
audio effects; they are a third device class on the note path.

Where they sit in the architecture (the keystone, reused):

- **Catalog + registry, same as everything.** A MIDI effect is declared once as a param schema
  + catalog entry (a new `src/audio/midi/catalog.ts`) and realized by a pure transform factory
  in a registry (`Record<MidiEffectType, ...>` off the catalog keys, so a cataloged type with
  no factory is a compile error). UI, MCP, automation, and persistence are projections of the
  schema, exactly like instruments/audio effects - no per-type branching. The library's add
  menus, the MCP palette, and the device rack pick them up by iterating the catalog.
- **A per-track MIDI-effect chain**, ordered, living on the `InstrumentTrack` (alongside
  `params` + the audio `effects` chain): `midiEffects: MidiEffectInstance[]`. Audio tracks have
  no note path, so no MIDI chain. Each entry is `{ id, type, bypassed, params: ParamStore }`,
  the same shape as `EffectInstance` - reuse the chain CRUD (add/remove/move/bypass) and the
  `EffectChain` UI, just over a different host list.
- **Pure functions on notes, not on the audio graph.** Unlike audio effects (Web Audio nodes
  bound by the engine), a MIDI effect is a pure `(notes, ctx) -> notes` transform. The DOM-free
  Node MCP server can hold the catalog *and* the transforms (they touch no Web Audio), which
  keeps the engine/`registry` split clean and lets the agent reason about note output.

Where they run (the seam): the **scheduler** already reads a placement's clip notes as pure
data per tick and emits onsets to the instrument (`scheduler.ts`, `tileClipNotes` /
`notesStartingInBeatRange`). A MIDI effect chain is applied to that per-clip note list as a
fold - `chain.reduce((notes, fx) => fx.bypassed ? notes : transform[fx.type](notes, ctx),
clipNotes)` - *before* the onset math. `ctx` carries tempo, beats-per-bar, the loop/clip
length, and the placement window, so an arpeggiator can quantize to a rate and a swing.

Two honest subtleties to design around:

- **Time-expanding transforms vs the lookahead window.** An arpeggiator emits notes that did
  not exist in the clip, at rates finer than the source notes. The scheduler's bounded
  lookahead means the transform must be a *function of an absolute beat range* (produce all
  arp steps whose onsets fall in `[fromBeats, horizonBeats)`), not a stateful streaming filter
  - otherwise notes straddling a tick boundary get dropped or doubled. Model each MIDI effect
  as `notesInRange(clipNotes, range, ctx) -> notes`, mirroring how audio onsets are already
  computed, so it composes with looping/tiling.
- **Note-offs / held chords.** The arpeggiator needs to know which notes are held together at a
  given beat to cycle them. Clip notes already carry `start` + `length` (so a "held chord" is
  notes overlapping a beat), which is enough to compute arp steps purely from the clip - no
  live note-on/off state required for *playback*. Live keyboard input through a MIDI effect
  (real-time arpeggiation of what you play) is a later extension that needs the held-set state
  and reuses the same transforms.

Fit with the rest:

- **MCP**: arms the same catalog-driven verbs as audio effects - `add_midi_effect`,
  `set_midi_effect_parameter`, `bypass_midi_effect`, `move_midi_effect`, `list_midi_effects` -
  validated at the boundary from the schema (`specToZod`). The agent can build an arpeggiated
  part by adding the device and setting params, not by writing out every note.
- **Persistence / history / undo**: the chain serializes like the audio chain (type + params +
  bypass); every add/remove/param change is a durable authored edit, so the feed, undo/redo,
  and version history cover MIDI effects for free.
- **Automation**: because params are schema-driven `ParamStore`s, arp rate/gate/swing automate
  through the same automation lane work as any other parameter.

Slice sketch (when picked up): (1) catalog + registry + per-track chain model + the
`(notes, range, ctx)` seam in the scheduler + persistence, with the **octavator** as the
trivial first transform (stateless, no new timing) to prove the path end to end; (2) the
**arpeggiator** (rate/mode/gate/octaves/swing) over the range-based transform; (3) MCP tools +
reuse the `EffectChain` UI for the MIDI chain. Live-input (real-time) arpeggiation is a later
extension once MIDI device input (section, "Recording & input") lands.
