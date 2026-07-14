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

**MCP transport, local now / remote later (roadmap).** Today the MCP loop is entirely *local*:
the Node MCP server runs on the user's own machine (started by their MCP client over stdio) and
listens on `ws://localhost:8765`; the browser tab connects *out* to it. This keeps working after
the web app is deployed - a hosted `https://` tab may still open `ws://localhost` (browsers treat
localhost as a secure-context exception), so a user running the local server drives their open
tab as before, and those edits flow through the same `dispatch("claude")` seam into the shared
session. That is fine for the tinkerer audience and needs nothing from hosting. **Deferred: a
remote/hosted MCP** so a user need not run a local process - the MCP server would reach the
project through the **sync authority** (server-side, addressed by `projectId` + the user's
principal) instead of a localhost socket, gated by the same JWT auth. This overlaps heavily with
the in-app agent panel (the client-side agent loop over the shared tool catalog), which is the
more natural "hosted agent" path; build the panel first and treat server-side MCP as the
power-user API onto the same authority. Not needed while local MCP suffices.

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

- **15F - multi-project library + switcher - DONE (slice 52).** The single hardcoded OPFS bundle
  became a **keyed multi-bundle store**: every project is its own bundle under `projects/<id>/`,
  `ProjectStorage` (in `bundleStore.ts`) enumerates/deletes them, and the `ProjectRepository`
  singleton is **retargetable by project id** (current id in localStorage, shared with the library).
  A `ProjectLibrary` store (`projects/library.ts`) caches the enumerated `{id, name, modifiedAt}`
  list + a subscribe seam; `projects/operations.ts` owns init/switch/create/rename/delete. A
  **switch is the import-in-place flow** (flush -> repoint repo -> `projectStore.load` +
  `editLog.restore` + `versionStore.reload`); the engine, MCP mirror, and autosave re-derive via
  subscriptions and the AudioContext is preserved. History + samples are per-project (they already
  live in the bundle). On first run an empty store seeds one project (the old single bundle is
  discarded per the no-legacy rule). Enumeration uses the OPFS directory handle, so this needed no
  disk access - 15D (a user-visible disk folder) remains the durable follow-on.

- **The VSCode-style spine - activity rail + in-panel chrome - DONE (slice 53).** The ever-growing
  left library and the split right panel became a proper editor spine, with **no separate top
  toolbar** - the chrome distributes into the pieces it belongs to. A thin **activity rail**
  (`ActivityRail.tsx`) on the far left switches the panel between one view at a time - Search /
  Project / Instruments / Effects / Patches / Samples / Activity - and clicking the active icon
  collapses the panel to just the rail (state lifted + persisted in `AppShell`; `usePersistentString`).
  The **library panel header** carries the app chrome: a **search box** above the view title (typing
  jumps to the **Search** results view - grouped matches across instruments/effects/patches/samples),
  an **undo/redo** menu left of the title, and the **MCP** status dot on the right. The selected
  track is a single editor **tab** in the workbench header (`CenterWorkbench`, reserving space for
  future multi-window tabs); Save-as-patch moved beside the device rack and the clip name beside the
  piano roll. Activity + version history moved into the left rail's **Activity view**
  (`ActivityView.tsx`); the **Project view** (`ProjectView.tsx`) is the real explorer
  (list/switch/create/rename/delete + export/import); **import audio** moved into the Samples view.
  The **right agent pane collapses away entirely** (no idle rail) - its expand control lives at the
  right of the workbench tab bar, keeping the agreed agent-right direction until the chat lands. An
  empty Sampler picker offers a "browse the library" affordance that reveals the Samples view
  (`SamplePicker` `onReveal`, threaded up). Follow-ons: real multi-window editor tabs, navigable
  search results that jump to a track, the agent chat itself, drag-a-sample-into-the-Sampler, and
  MCP project tools.

- **Project explorer tree - DONE (slice 54).** The Project view became a real explorer for the
  *current* project: a tree of the `main` group and its tracks (`ProjectView.tsx`, derived from the
  `parentId` forest). Clicking a track selects it - selection is one shared value (`selectTrack`), so
  the workbench + timeline follow, and the arrangement scrolls the selected lane into view
  (`data-track-id` + a `scrollIntoView` effect). Expanding a track row reveals compact mixer controls
  (mute/solo/gain; sends are a placeholder). The project **title + switcher merged into the panel
  header's main menu** (`LibraryHeader.tsx`): the header shows the project name (double-click to
  rename) and one menu holding undo/redo + switch/new/rename/delete/export/import; the MCP dot moved
  to the workbench tab bar. Search now includes a **Tracks** section, and emptying the box returns to
  the previous view. Grouping changed from per-instrument-family groups (the old "librarian") to a
  **single default `main` group** every new track files into; manual grouping is the follow-on below.

- **Empty tracks + full-height rail - DONE (slice 55).** A track can now be created with **no
  instrument yet** and assigned one later. The engine gained a hidden **`none` sentinel instrument**
  (`Silent.ts` - empty schema, silent factory, excluded from the library/search/MCP palette via a
  `hidden` flag + `pickableInstrumentInfos`). A new **`setInstrument` command** (protocol + applyEdit
  + describe + `ProjectStore.setInstrument`) rebuilds the track's ParamStore from the new schema
  (shared param ids carry over) while keeping clips/placements/effects; the engine reconcile now
  diffs `TrackNode.instrumentType` and swaps the node when it changes. Create an empty track from the
  project-tree group **+**, or the timeline's **New track in** / group **Add empty track** menus
  (these no longer default to a subtractive). The workbench device rack shows a **"choose an
  instrument" picker** when the selected track is empty; the kind chip reads `empty`. Also: the
  **activity rail became its own full-height column** (spans both grid rows, reserving the
  bottom-left), and **acting on a search result returns to the view open before searching**.

- **Grouping roadmap (follow-ons).** (a) **Drag tracks into groups** (and reorder) in the
  tree/timeline - needs DnD wiring over the existing `moveTrack`/`moveGroup`. (b) **Right-click add**
  menus (add group / add track) in the timeline and the project tree.

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
  - *Context-menu popover could open offscreen - FIXED (slice 42).* `Menu` positioned its portal
    popover at `top: trigger.bottom + 4` with no viewport clamp, so a trigger near the bottom edge
    (e.g. the last track's ⋮) opened a menu that ran off the bottom; same for the right edge. Fix: a
    `useLayoutEffect` in [ui/Menu.tsx](src/ui/Menu.tsx) measures the popover and clamps it inside the
    viewport, flipping above the trigger when it would overflow the bottom (before paint, no flash).
  - *Held note stuck on when you switch tracks mid-press - FIXED (slice 42).* The computer-keyboard
    play handler in [ui/AppShell.tsx](src/ui/AppShell.tsx) read `projectStore.selectedId` on **keyup**
    to pick which instrument to release. Press a key (note-on on track A), select track B, then
    release: keyup called `noteOff` on track B's instrument, so track A's voice never released and rang
    forever. Fix: a `heldKeys` ref (`Map<midi, instrumentId>`) remembers which instrument each held key
    started on and routes the matching note-off there regardless of the current selection. (Web MIDI /
    the on-screen keyboard will want the same per-source held-note bookkeeping.)
  - *Center panel reflow when the activity panel expands - RESOLVED (verified slice 42).* Originally
    the center could be clipped instead of reflowing when the activity panel grew. The flow-layout
    rework (slice 31: `grid-template-columns: ... minmax(0, 1fr) ...` for the center column plus
    `min-w-0` on the workbench) already sized the center from the remaining space, so it now reflows
    correctly - confirmed by measurement (center 760 -> 1027 when the panel collapses, back to 760 when
    it expands). Locked with a regression test in [e2e/layout.e2e.ts](e2e/layout.e2e.ts).
  - *Audio clip double-trigger when its loop region isn't bar-aligned - FIXED (slice 37).* The audio
    path in [sequencer/scheduler.ts](src/audio/sequencer/scheduler.ts) tiles the clip's region across
    the placement *and* `onsetsInBeatRange` wraps each onset over the arrangement loop, so when the
    region length didn't divide the loop length, onsets near the loop boundary overlapped (the region
    rang on past the boundary while the loop restarted = a slightly-offset second copy). Fix: the
    scheduler now passes a `maxDurationSec` (time to the next loop boundary) to `scheduleAudioClip`,
    and the pure [audioPlayWindow](src/audio/engine/audioWindow.ts) truncates the played span there -
    the region is cut at the loop boundary and the restart plays cleanly (correct loop behaviour). A
    fade at the cut to avoid a click on hard-cut audio is a possible future refinement.
  - *No playhead/ticker on an audio clip in launch (clip) mode - FIXED (slice 37).* A launched clip
    plays via a synthetic placement (`{ id: '__launch', ... }`) not in `track.placements`, which the
    clip-panel playhead ([ui/CenterWorkbench.tsx](src/ui/CenterWorkbench.tsx)) scanned, so it stayed
    hidden. Fix: when `track.launchedClipId === clip.id` the playhead uses the transport loop region
    as the active window (mirrors the scheduler's synthetic placement).
  - *BUG (FIXED, slice 37): e2e start-race flake.* `engine.start()` awaiting the worklet modules
    (slice 36) made it resolve a beat later, so tests that clicked the grid right after "start audio"
    raced the start-overlay removal / re-layout and intermittently missed. Fixed by making each e2e's
    `dismissStart` wait for the start button to clear (`toHaveCount(0)`) before interacting.
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
- **Transport & grid:** ~~time signature, metronome, timeline beat markers~~. Metronome (slice 27)
  and beat markers (slices 33, the audio-clip ruler) are DONE; **changeable time signature** remains.
  - *Time signature (own slice).* Today `BEATS_PER_BAR = 4` is hardcoded in the scheduler and the
    rulers. Make it a transport-level project value (`{ numerator, denominator }` on `ProjectData`,
    default 4/4) with a `setTimeSignature` edit, surfaced beside the tempo control. It threads through
    the metronome accent (downbeat per `numerator`), every bar/beat `Ruler`, the arrangement grid
    snap, and `beatsToSeconds`/loop math. Keystone-friendly: one transport value projected into the
    scheduler, the rulers, and MCP - no per-site hardcoding.
  - *Timeline loop enable/disable toggle.* The arrangement has a loop **region** (start/length handles)
    but no way to turn looping off - the scheduler always wraps at `loopStart + loopLen`. Add a
    transport-level `loopEnabled` flag (a loop button by the transport, the region handles dim when
    off) so playback can run straight through to the arrangement end. Transient-vs-durable: lean
    durable (persist it with the project) like the loop region itself.
- **Mixer controls.** Track + group headers carry an adjoined **Mute/Solo** group (solo is a
  per-track/group flag; the engine silences anything not solo-active - see `engine/mix.ts`) and a
  low-profile **fader** (a line with a triangle ticker; `ui/MixerControls.tsx`). *Pending:* a
  **live level meter** overlaid on the fader (red when clipping) - the `Fader` already accepts
  `level`/`clip`; needs per-bus metering in the `AudioEngine` (AnalyserNodes) + a rAF read loop.
  *Includes live input/mic monitoring:* when an audio track is armed, feed its capture stream
  through the same metering so the fader shows the incoming mic level (pre-record, no audio routed
  to output - input monitoring stays hardware/direct per section 12), giving a visual "is it
  hot / is it clipping" check while setting levels before a take.
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
  follow-ups below (grooves, project key) still pending; quantization is now done.*
- **Quantization - DONE.** The keystone change was removing the **destructive force-snap** from
  `ClipStore` (it used to round every note to a 16th on input, killing recorded feel): notes now
  hold their true positions, the store only coerces (clamp/min-length), and the UI still snaps at
  *edit* time. Quantizing is now an explicit pure op (`src/audio/sequencer/quantize.ts`, shared by
  the roll UI and the Node MCP server): an adjustable grid (reusing the roll's snap division, incl.
  triplets, all from one `GRID_DIVISIONS` list) and a strength (partial pull). The roll exposes a
  **Quantize** action (selection or whole clip, one `editNotes` = one undo step), an **Auto-Q**
  toggle (lights up; snaps takes as they record), and a **⋯ settings** menu (strength, snap-ends).
  An MCP `quantize` tool mirrors it. *Forward-compat for grooves/time-signature:* every grid calc
  reads `GRID_DIVISIONS`/the snap division (no hardcoded 16ths), so those later slices drop in.
- **Grooves - DONE (v1, global).** A groove nudges note timing (swing) + scales velocity **at
  schedule time** by the slot each note lands in, over **untouched** stored notes - non-destructive
  and instantly toggleable (the un-snap work made it possible). v1 is a **project-wide** groove: a
  preset catalog (`src/audio/grooves/catalog.ts` - Straight + 8th/16th swing + an accent feel,
  iterated by the timeline-options ⋯ menu and MCP) plus an **amount** (25/50/75/100%), resolved once
  per tick and applied in the scheduler (`src/audio/sequencer/groove.ts`, pure/shared). A groove tiles by its own
  period (no `BEATS_PER_BAR` dependency), so it is meter-agnostic. Wired as a `setGroove` command +
  `set_groove`/`list_grooves` MCP tools; persisted (project schema 8). Offsets are in beats (no PPQ).
  *Follow-ups:* **per-track override** (pairs with the drum machine, where "swing the hats not the
  kick" matters) and groove **extraction** (analyze a clip's deviations into a template).
- **Key & tonic-relative intervals - roadmap (pairs with the flagship synth as its test-bed).** Make
  **key** (a `{ tonic: 0-11, scale/mode }`) a first-class musical unit that the roll display and the
  computer-keyboard input are both projections of. The two halves of this reinforce each other: a
  tonic-relative model is precisely what lets the QWERTY keyboard span **4 octaves**, because diatonic
  degrees pack ~7 per octave (one keyboard row) where chromatic needs 12 (which doesn't fit a 10-key
  row). Design:
  - *Data model unchanged.* `NoteEvent.pitch` stays **absolute MIDI** (transposition-safe, interop-
    friendly, and the scheduler/engine never learn about keys). Key is an **input/display layer**:
    display maps absolute -> degree; the keyboard maps degree -> absolute. A pure projection, no
    persistence change - which is the same "everything is a projection of the schema" discipline the
    rest of the app follows. Key lives at **project level** first; per-clip / per-section overrides are
    a clean follow-on.
  - *Keyboard = diatonic by default.* Replace the hardcoded single-octave `KEY_MAP`
    ([AppShell.tsx](src/ui/AppShell.tsx)) with a map **generated from the current key**: the four
    letter/number rows become four octaves of the scale, so playing is always "in key". A modifier
    (e.g. Shift) raises a semitone for accidentals; the layout mode (diatonic vs a chromatic /
    isomorphic option) can be a setting.
  - *Display = scale highlighting first, note color last.* Hue is reserved for the two-voice authorship
    coding, so degree must **not** ride on hue. First cut: **scale highlighting on the piano-roll lane
    backgrounds** (in-key rows lit, the tonic row accented - the pattern many DAWs use) plus optional
    **degree labels** on notes (`1 b3 5`...). Note *fill* stays authorship color. A later opt-in can
    encode degree on a non-hue channel (brightness / saturation within the authorship hue) so both
    codings coexist.
  - *MCP payoff:* exposing key in project state lets the agent compose diatonically ("add a ii-V-I in
    the project key"). Pairs with the autotune scale-snap layer under "Audio pitch & time".
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
- **Timeline & clip-editing usability (batch, follow-ons).** A set of arrangement / piano-roll
  interaction gaps and small features. Several are touch-shaped by design (see the touch-first note
  under Platform & form factor): every new action wants a right-click menu *and* a tap-reachable
  equivalent.
  - *Drag placements between tracks.* Today `movePlacement` only changes `startBeat`, so a placed
    clip can move along its lane but not onto another track. Extend it (or add a cross-track move) so
    a MIDI / audio placement drags onto any same-kind track's lane, mirroring the existing rail-drop
    copy path.
  - *Split from a lane context menu.* Splitting is double-click-only today. Add a "Split here" item to
    a lane's right-click (and touch three-dots) menu, acting at the lane's selection marker. This
    needs **clicking a track to also drop the selection marker on it** (today a click only selects the
    track), so the marker is where the split lands.
  - *Clip layering / stacking (promote the overlap).* Overlapping placements on one lane already
    "just work"; make it an intended feature - MIDI / audio clips may stack on the same track, drawn
    **semi-transparent** so lower clips / notes / audio read through. Needs: a **replace-vs-stack
    prompt on clip drop**; **multi-select of tracks** (shift-click, plus a multi-select mode in the
    timeline-options menu for touch); and a **merge / combine-tracks** action (right-click /
    three-dots) that flattens the selected tracks' clips into one.
  - *Bug: note-drag snapping.* Dragging a note in the piano roll doesn't always land its start on a
    grid line - the onset can end up off-grid. The snap should apply to the note onset consistently
    (audit the `snapBeat` / drag-origin math in the roll).
  - *Draw-to-length note creation.* A press-drag on the piano roll should place a note and set its
    length in one gesture (today a click adds a fixed-length note).
  - *Clip start / loop-start handle.* The roll has an end / length handle but no clip-start handle, so
    a placement's `offset` (where the clip starts) can't be moved off 0 from the UI. Add a start
    handle so the clip's start point is draggable.
  - *Don't auto-place a blank clip.* Creating a track / instrument should not drop an empty clip on
    the timeline; the pool clip exists, and the user drags it onto a lane intentionally.
  - *Context menus on clips + tracks.* Both the timeline and the panel give clips and tracks a
    right-click context menu, plus a **persistent three-dots (⋮) affordance** (not hover-only) so the
    same actions are reachable by touch.
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
- **Record arm + into-track - DONE (slice 29).** Per-track record-enable (a grey->coral circle on
  audio track headers) arms one track; Record then lands the take on it via the new `addAudioClip`
  edit (clip + placement, ids pre-minted -> deterministic replay), else a fresh track. The
  transport Stop (and spacebar) now finalize the take, not just halt it. Audio tracks get the
  vertical clip rail (recordings as chips) with a footer Record button.
- **Recording UI polish - DONE (slice 30).** Mute/solo line up across group and track headers via
  a shared leading "gutter" (collapse arrow for groups, record-enable for audio tracks, empty
  otherwise; tracks render at their group's depth). Recording settings (count-in, input device)
  moved off the transport into the existing toolbar menu (now "Timeline options"), alongside the
  per-group "New track in" - all three are **nested submenus** so the menu stays short. `Menu`
  gained submenu flyouts, radio (`checked`) items, and separators to support this.
- **Workbench signal-flow layout - DONE (slice 31).** The center workbench reads top to bottom as
  the signal path: notes (piano roll) / audio clip on top, the instrument + effect rack below, then
  the arrangement output (bottom panel) - notes -> (midi fx ->) instrument -> effects -> output. The
  thing you primarily edit is at the top with its sound controls right beneath it (rather than the
  rack crammed at the bottom). MIDI effects (section 15) will slot between the roll and the rack.
- **Audio waveform overview - DONE (slice 32).** Audio clips show their amplitude trace - in the
  arrangement placement block and the center audio-clip panel. `waveform.ts` decodes the OPFS bytes
  once via an `OfflineAudioContext`, computes a cached min/max **peaks** array per `fileId` (pure,
  unit-tested `computePeaks`; 2048 buckets; mono mix), and `Waveform.tsx` draws it to a **canvas**
  that fills its parent (ResizeObserver redraw on zoom), in the theme accent. Falls back to the plain
  block while decoding / on failure. v1 stretches the clip across the block (a recorded take's
  placement is its natural length, so 1:1); tiling looped windows + a spectrogram are follow-ups.
- **Audio clip beat grid + loop region - DONE (slice 33).** A bar/beat `Ruler` over the waveform in
  the audio-clip panel with draggable loop start/end handles sets the clip's region
  (`loopStartSec`/`loopEndSec`) as a `setAudioClip` edit. No scheduler rework: the engine plays that
  slice via `source.start(when, offset, duration)`, and the existing per-placement re-trigger tiles
  it (a placement longer than the region repeats it = looping). Same slice: clip **gain > 1** (clamp
  4x / +12 dB; master limiter guards clipping) so quiet recordings can be boosted.
- **Audio clip panel feedback - DONE (slice 34).** The clip-gain control uses the shared `Fader`
  (with a `max` prop, `max=4`); the `Waveform` scales its trace by the clip gain and paints any
  column past full scale in the warning colour (clipping is visible as you boost), in both the clip
  panel and the arrangement block; and a live playhead in the clip panel follows the active placement
  and sweeps the loop region in sync with the transport.
- **Slide audio under the grid - DONE (slice 35).** A per-clip **content offset** (`gridOffsetSec`
  on `AudioClipData`, a `setAudioClip` patch) so a transient can be lined up with a bar line. The grid
  and the loop window are the fixed frame; the **audio slides underneath** (drag the waveform in the
  clip panel, double-click or "reset" to zero it) so a different part of the recording sits under the
  window. The loop markers + playhead stay put on the grid. Audibly the played buffer slice is the loop
  window shifted back by the slide - resolved by the pure, unit-tested `audioPlayWindow` helper
  ([engine/audioWindow.ts](src/audio/engine/audioWindow.ts)): it clamps the slice to the buffer and, if
  the slide pushes the window's head before the buffer, renders that head as silence (a delayed source
  start) rather than playing earlier samples; the slice still plays *at* the placement onset and tiles
  as before. Persists via the clip spread (no format bump). *Follow-ups:* the arrangement block's
  thumbnail still draws the whole buffer (ignores offset + loop region); a per-placement nudge (vs
  per-clip) is a later option.
- **Audio pitch & time (own slice, harder).** (a) **Pitch-shift** - change a clip's key while keeping
  its speed; and (b) **time-stretch** - change speed while keeping pitch (also the basis for warp /
  tempo-following audio). Web Audio's `playbackRate`/`detune` couple the two, so both need a real
  pitch/time algorithm (phase vocoder / WSOLA). Pragmatic path: integrate a JS/WASM library
  (SoundTouch.js for a first cut; signalsmith-stretch / Rubber Band for quality), run it **offline**
  over the decoded buffer to produce a derived buffer cached by `(fileId, semitones, ratio)`, and
  point the clip at it; a ±semitone + tempo-ratio control on the clip. Realtime worklet shifting +
  Ableton-style **warp markers** (align transients to the grid) build on this later.
- **Autotune / pitch correction (follow-on to audio pitch & time).** Detect a recorded vocal's
  fundamental-frequency (f0) contour and remap it toward the nearest scale note. This is the **same
  shifting engine** as clip pitch-shift, driven by a *dynamic, time-varying* shift ratio
  (`target note / detected f0`) instead of one constant ±semitone - so do clip pitch-shift first and
  autotune becomes a layer on top, not a from-scratch build. The added layers are the JS-friendly,
  Claude-fluent parts: **(1) pitch detection** - YIN/autocorrelation over `Float32Array` (offline,
  go further with pYIN + Viterbi smoothing for a clean track; unit-testable with synthetic tones);
  **(2) musical control** - snap to scale/key with a retune *amount* and *speed* (slow natural
  correction vs hard-snap), reusing the planned **project key/scale** work. Frame it as an **offline
  clip processor** (recorded clip in -> corrected clip out via OfflineAudioContext + the sample
  store), like audio pitch & time; a realtime worklet effect is much harder and a later step.
  Engine caveats vs constant pitch-shift: autotune needs an engine that supports a **time-varying**
  ratio (phase vocoder with per-frame ratio, or pitch-synchronous PSOLA - a plain stretch-then-
  resample only does a constant ratio), and **formant preservation** matters far more for a voice;
  caching is by `(fileId, settings-hash)` since the result is content-derived, not a tiny param key.
  Faust note: it does *not* meaningfully ease this - detection and the musical layer are awkward in
  Faust and fluent in JS, and its stock `ef.transpose` shifter is the artifacty, non-formant-
  preserving kind. Keep the **shifter core as a swappable node** (a quality JS/WASM stretch lib, or
  Faust) behind our effect interface if CPU/quality demands it; build detection + control in JS.
- **Recording follow-ups (later):** MCP arm/record tools, input level meter, remembered device +
  eager enumeration, software-monitoring option, loopback **latency calibration** (store the offset
  on the region), punch-in at the playhead, multi-track arm, stereo.
- **MIDI recording - DONE (slice 40).** Recording now works for instrument tracks too: the
  target's kind picks the mode (an audio track captures the mic, an instrument track captures
  live MIDI notes). Record arms the armed track, or - if nothing is explicitly armed - the
  selected track, and a take **punches in** over the lane (its clip replaces whatever it overlaps,
  trimming/splitting straddlers; undo restores them via the snapshot checkpoint). Live notes are
  tapped from the computer keyboard in `AppShell` and stamped against arrangement beats by the
  `Recorder`; on stop they become one `addNoteClip` edit (clip + notes + placement, ids pre-minted,
  pure data). Notes land on the 16th grid (the `ClipStore` snaps, like the rest of the app). Record
  buttons sit on the transport, every track header, and the clip rail (both kinds).
  The piano roll shows a **live overlay** of the take as it is played - notes already released
  draw as static ghosts, the note still held grows out to the playhead each frame - in the record
  colour, so you watch the clip fill in (slice 40).
- **MIDI device input (Web MIDI API) - roadmap.** Capture from a real MIDI keyboard / controller
  (not just the computer keyboard) with true velocity and (later) aftertouch/CC. Routes into the
  same `Recorder.noteOn/noteOff` capture path and live monitoring, so recording, the live overlay,
  and quantize all come along; just a new input source + a device picker.
- **Quantize - DONE.** The `ClipStore` force-snap is gone (notes keep exact timing); quantize is an
  explicit strength/grid action on a selection-or-clip, with an **Auto-Q** toggle for snap-on-record
  (the per-take raw-vs-quantized choice) and an MCP `quantize` tool. See the "Quantization - DONE"
  entry under the real-DAW pieces above for the full shape.
- **Overdub & punch options - roadmap.** Record into the existing clip (merge takes) instead of
  always punching in a fresh clip; a loop-record mode that stacks takes; MCP arm/record tools.

**Instruments, content & ecosystem**

- **MIDI effects (arpeggiator, octavator)** - a third device class on the note path, transforming
  notes before the instrument. Cataloged + schema-driven + per-track chain like audio effects;
  pure `(notes, range, ctx)` transforms run in the scheduler. Full design in section 15.
- **Sampler instrument - DONE (slice 50, PR 1 of the drum arc).** A single-voice, one-shot
  Sampler plays an audio buffer chromatically (keytracked playback rate around a root note). It is
  the first consumer of a new keystone **`sample` param kind** (a tagged-string ref: `builtin:<id>`
  now, `file:<fileId>` for imports later) - so the picker, MCP, persistence, and patches all
  project off the schema with no per-instrument branching. It ships a small **built-in CC0 kit**
  (kick/snare/hats/clap/rim/tom) synthesized from scratch (`src/audio/samples/assets/generate.mjs`,
  unambiguously CC0) and bundled via Vite `?url`; the shared voice was generalized from
  `oscillators` to `AudioScheduledSourceNode[]` so a buffer source reuses the base envelope.
  *Follow-up done in PR 2 (slice 51):* see the sample library below.
- **Sample library + local import - DONE (slice 51, PR 2 of the drum arc).** Imported samples get an
  **asset-record layer**, the lesson from how Unity/Godot/Git-LFS/Bazel separate identity from bytes
  from derived artifacts: a project-level `SampleAsset { id; name; contentHash; source? }` where the
  stable `id` (not the hash) is what a `sample` param references (`asset:<id>`), so trimming or
  re-encoding a sample never breaks references. The content hash is just the current bytes in the
  OPFS blob store (dedup + integrity); decoded buffers are a regenerable cache keyed by hash. Local
  import (Library panel "Samples" section + inline in the Sampler picker) stores the file, dedupes by
  hash, and adds an asset record; instruments resolve `asset:<id> -> hash` through a small
  `sampleRegistry` the engine syncs on reconcile (instruments only get `(ctx, store)`). MCP
  `list_samples` reports built-ins + the project library; import is browser-only (Node can't read
  local files / hash / write OPFS). *Follow-ups:* **remote sample browsing** (Freesound CC0 et al via
  a same-origin proxy on the Node server - their media servers send no CORS headers and downloads
  need OAuth2; pulling a remote sample hashes + stores + records license/source); **waveform peaks +
  tags/search** over the library index; doing the OPFS bytes I/O + hashing + peak generation in a
  **Worker** (the AudioWorklet can't touch OPFS, `crypto.subtle.digest` is one-shot, `decodeAudioData`
  detaches its buffer); and `navigator.storage.persist()` + a quota meter (OPFS is evicted LRU). The
  **drum rack** + the deferred **per-track groove override** is the next slice (pads reference the
  same library). Also: the left **Samples view lists only the project's imported assets** - the
  bundled CC0 built-ins (`BUILTIN_SAMPLES`, offered in the sample picker's "Built-in" group) don't
  appear there. *Follow-on:* surface the built-in kit as a "Built-in" group in the Samples view too
  (and make library entries drag-able onto a pad / the Sampler, folding into the `sampleDnd` follow-on).
- **Drum machine (drum-kit instrument + step grid) - DONE (slice 58).** A **`drumkit`** instrument
  ([instruments/Drumkit.ts](src/audio/instruments/Drumkit.ts)): a bank of one-shot sample players (up to
  `DRUMKIT_PADS`) where a played MIDI note *selects a pad* rather than pitching one sample. **Which note
  fires a pad is itself a param** (`pad{n}.note`, defaulting to a contiguous octave up from
  `DRUMKIT_BASE_NOTE` = middle C), so the mapping is data - visible in the panel, settable over MCP,
  remappable to a GM/hardware layout - and `Drumkit` resolves note -> pad from those params at play time
  (no hardcoded inverse). Each pad is a `sample` ref + note + level + tune (tune snaps to whole
  semitones via a new `step` on the number spec), all schema-driven (`pad{n}.sample/note/level/tune`),
  so it needs no per-pad code. Defaults load the built-in CC0 kit into the first pads. The device rack
  gives the kit its own **[DrumkitPanel](src/ui/DrumkitPanel.tsx)** (chosen the same way as the editors
  below) instead of the generic knob panel: a compact pad-per-cell layout (note-name selector in the
  title, sample picker, horizontal Level/Tune faders) that shows only pads in use plus an **Add pad**
  button, so a fresh kit isn't a wall of blanks.
  - A drum-kit track edits notes as a **pad x step sequencer grid** ([ui/StepGrid.tsx](src/ui/StepGrid.tsx))
    or the ordinary **piano roll** - a per-track **Pads | Keys** toggle (default Keys). Both drive the
    **same note-clip model** (a hit is a note at the pad's assigned note), so a beat is just notes -
    playable, undoable, sequenced by the same scheduler, editable either way - and the step/playhead
    lights up as it plays.
  - "Keys" is the exact same `PianoRoll` (unchanged looping/editing) via a thin
    [ui/DrumRoll.tsx](src/ui/DrumRoll.tsx) wrapper passing one optional `rows` prop: rows map to pads, so
    a **reserved left gutter** reads "C4 Kick" (assigned note + drum) beside the notes (not over them,
    with ellipsis), loaded pads are tinted, and it frames to the assigned notes. The chromatic keyboard
    is the default `rows` (floating C-labels, no gutter), so every other instrument's roll is untouched.
  - A drum-kit sound is one shot *per pad*; playing a single sample *chromatically* across the keyboard
    stays the Sampler's job. *Follow-ups:* per-pad velocity/choke, a 16-step clip default (the grid
    handles any length today), and the two sourcing/synth paths below.
- **Drum-kit sourcing + synthesized voices (follow-ons).** Two complementary paths, not either/or (the
  Sampler + the `drumkit` instrument above are the shared substrate for the sampled path):
  - *Synthesized classic voices (preferred for 808/909/707/606/LinnDrum).* The analog machines are
    very synthesizable (sine + pitch-drop kick; noise + bandpass snare/hats), so model each voice as
    a schema-driven instrument in the catalog/registry rather than shipping static WAVs. This fits the
    parameter-schema keystone (tunable + automatable + MCP-drivable for free), reuses the synth engine,
    and **sidesteps sample licensing entirely** - the legendary Roland recordings have murky rights.
  - *Sampled kits via the **Sampler instrument** (above) for acoustic / character kits.* The constraint
    for a (possibly distributed) web app is a license that permits **redistribution inside software**,
    not just "free to use in your music": prioritize **CC0** (public domain, zero friction) then
    **CC-BY** (keep a CREDITS file); avoid CC-BY-NC and "royalty-free for music only" packs. Verify the
    actual license text per pack before bundling - terms drift. Curate small for the web (one velocity
    layer per voice; OPFS content-addressed storage already exists). Clean, openly-licensed sources to
    lean on: **DrumGizmo** kits (Black Pearl / MuldjordKit / Crocell, CC-BY-SA / some CC0; full
    multi-velocity acoustic), **AVLDrumkits** (same lineage), **Salamander Drumkit** (CC-BY),
    **Hydrogen** drumkits (GPL/CC, incl. some electronic kits), **Freesound** filtered to CC0, and the
    **TidalCycles Dirt-Samples** one-shot collection (GitHub; mixed licensing, check per folder).
- **Open-source instrument & effects library:** grow the catalogs, possibly a shareable /
  community device format (open question).
- **Custom-DSP AudioWorklet framework - DONE (slice 36), part A of the worklet intro.** The
  ceiling of the node-graph approach (no per-sample logic / block algorithms) is lifted by a
  worklet authoring + loading seam: worklet processors are authored in **TypeScript** under
  `src/audio/worklets/` and bundled by Vite via the `?worker&url` import suffix (which transpiles
  + inlines the worklet's imports and returns a URL for `addModule`); the pure DSP they run lives
  in shared, unit-tested modules under `src/audio/dsp/` (the worklet is a thin realtime shell).
  `worklets/index.ts` is the single module registry; `AudioEngine.start()` awaits `loadWorklets`
  before building the graph so worklet-backed effects construct synchronously. Proven on two
  processors: the new **bitcrusher** effect (per-sample quantize + sample-hold downsample, `bits`
  / `downsample` as real `AudioParam`s, impossible with native nodes) and the recording
  **capture** worklet (ported from the old `public/capture-worklet.js` to TS). A worklet effect
  is the same three-touch extension as any effect (class + catalog + registry), so it appears in
  the UI rack and the MCP palette automatically. Worklet-scope globals are declared in a tiny
  ambient `worklets/audioworklet.d.ts` (no dependency).
- **Worklet *instrument* framework + wavetable synth - DONE (slice 39), part B of the worklet
  intro.** A `WorkletInstrument` base ([instruments/WorkletInstrument.ts](src/audio/instruments/WorkletInstrument.ts))
  implements the `Instrument` interface over an `AudioWorkletNode`: note events post to the
  processor with their absolute `when` (the scheduler's lookahead delivers them ahead of time, so
  the processor places them **sample-accurately**), and params bind **generically** - every number
  param in the schema binds to the processor's same-named `AudioParam` via `rampParam`, so a
  worklet instrument needs no per-param code, just a processor name + matching
  `parameterDescriptors`. Shipped on it: a polyphonic **wavetable synth** (a morphing bank of
  single-cycle tables in pure `dsp/wavetable.ts`; the processor runs a 16-voice pool with linear
  attack/release envelopes, a one-pole tone control, and the sample-accurate dispatch). Same
  three-touch extension as any instrument (catalog + registry + the worklet module URL), so it
  shows up in the library, the InstrumentPanel knobs, and the MCP palette for free.
- **Flagship synth (Nimbus) - DONE (slice 56); patch bank next.** A warm, Juno-inspired **polyphonic
  subtractive synth** built on the worklet-instrument framework (slice 39). Each of 16 voices mixes
  band-limited **saw + pulse (PWM) + sub + noise** (PolyBLEP, pure `dsp/oscillators.ts`) through a
  four-pole **resonant Moog-style ladder filter** (pure, unit-tested `dsp/ladder.ts` - the "the filter
  is the sound" investment, reusable by future synths), shaped by a **full ADSR** (the amp env also
  modulates the filter by an amount) with **key-track**, one global **LFO** (rate + delay/fade-in, to
  pitch / filter / PWM), and subtle per-voice **drift**. Continuous osc-level knobs (rather than on/off
  switches) keep every param a *number*, so `WorkletInstrument` binds them all generically - the synth
  appears in the library, the knob panel, and the MCP palette with no per-param code. Continuous
  modulation (pitch/PWM/cutoff) refreshes per block; the VCA envelope runs per sample. Its signature
  lushness comes from the existing **Chorus effect** (bundled into the patches). Remaining in the arc:
  (later) a **Minimoog-style mono** lead/bass voice reusing the ladder filter. Nimbus is the test-bed
  for the tonic-relative display (see "Key & tonic-relative intervals").
  - *Patch bank + auditioning - DONE (slice 57).* A shipped **factory patch bank** for Nimbus
    (`patches/factory.ts`, pure read-only data reusing the `Patch` shape) - categorized "inspired-by"
    presets (bass / lead / pad / keys / pluck / brass / fx) with original names, chorus bundled where
    apt; a unit test validates the whole bank against the schemas. Factory + saved patches appear in
    the Patches view, search, and **nested under their instrument** in the Instruments view (a
    collapsed-by-default disclosure with a count, so no clutter). **Clicking** an instrument/patch now
    **applies it to the selected track** (audition/play in place) via a new `applyPatch` edit - which
    mutates the existing ParamStore on a same-instrument apply so the engine's live bindings keep
    working, and replaces it on an instrument change - while a per-row **"+"** adds it as a new track.
    MCP sees the same content over the patch RPC: `list_patches` / `apply_patch` cover **factory +
    user** patches, and a new **`get_patch`** returns one patch's full params + effect chain (so the
    agent can inspect a sound or promote a user patch into the factory bank). Follow-on: **drag** an
    instrument/patch onto a track / device rack (a `sampleDnd`-style DnD).
- **The flagship-synth arc, as originally scoped** (kept for the licensing rationale + design notes;
  the synth itself landed above). Turn web-daw into a serious composition platform with one
  genuinely good analog-style synth and a bank of professional patches, built on the worklet-instrument
  framework (slice 39).
  - *Licensing posture.* Cloning a classic's **architecture and sound** is fine - signal topology is
    not copyrightable and the classic analog patents (e.g. the Moog transistor-ladder filter, ~1969)
    are long expired. Off-limits: **brand names and logos** (Minimoog, Juno, Prophet, TB-303,
    Moog/Roland/Korg), **slavish copies of the exact panel artwork** (possible trade dress - our param-
    schema UI sidesteps this anyway), and **copied preset names**. So: an **original instrument name**,
    our own UI, and **inspired-by** patches with original names. Parameter values themselves are
    functional data, not protected.
  - *Which to clone - a Juno-106-style poly synth first.* Polyphonic (pads/keys/strings - the broadest
    composition value, complementing the existing voices); a **small param set** (1 DCO + sub + noise,
    one filter, one envelope, an LFO, chorus) that maps cleanly to the schema, is easy for both humans
    and the agent to program, and is the shortest path to a patch bank that actually sounds pro. Its
    signature lushness is mostly the **chorus**, which also ships as a standalone effect. Voice #2 later:
    a **Minimoog-style mono** built around a proper ladder filter for bass/leads.
  - *The real work is DSP, not topology.* "Really good" is ~20% topology, ~80% details our current
    instruments lack: (1) **the filter is the sound** - a zero-delay-feedback / Moog-ladder model with
    musical resonance, self-oscillation, and drive (an AudioWorklet, not `BiquadFilterNode`), and it is
    **reusable across every synth**; (2) **band-limited oscillators** (the wavetable worklet is a good
    foundation) to avoid aliasing, plus **analog drift/detune** and **exponential envelope curves**; (3)
    a good **chorus/ensemble**.
  - *Arc (a few slices):* (1) **DSP foundation** - a shared ladder/ZDF filter worklet in `dsp/` + a
    chorus (also added to the effects catalog); (2) the **flagship poly synth** built on them (same
    three-touch catalog + registry + worklet-URL extension, so it appears in the library / knobs / MCP
    palette for free); (3) a **patch bank** (~20-40 categorized presets - bass / lead / pad / keys /
    pluck - original names, inspired by classic patch *types*, slotting straight into the existing
    patches library); (4) later, the **mono lead/bass voice**. This voice becomes the test-bed for the
    tonic-relative display above.
- **Adopt Prettier - DONE (slice 41).** A repo-wide Prettier config (double quotes, `printWidth:
  120`) + `yarn format` / `yarn format:check` + a CI format-check step, to end the editor
  quote-churn noted in CLAUDE.md. One-time whole-tree reformat in its own PR; double quotes match
  the editor's own default, so format-on-save and the pinned config agree and stay in line.
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

**Collaboration & multi-user (options, not a decided direction)**

These are candidate approaches for the 15E "remote sync / collaboration" follow-on, captured
so the tradeoffs are on record. Nothing here is committed; presence and shared editing may
land in either order, or not at all if the local-first single-user shape stays the priority.

- **Authorship colour model - a projection of the log, not a stored field.** The keystone
  already stamps every edit with its author (that is how the two-voice colouring works), so
  "who last touched this clip/track/param" is a *query over the command log* and the colour is a
  *view*, never a property saved on the object. This composes with versioning for free (the
  overlay at any commit is just the log up to that point) and needs no format change. Two modes
  worth separating because they answer different questions: (1) **live presence** - ephemeral,
  per-person hue on a cursor / selection, showing what someone is touching *now* (the Figma /
  Google-Docs experience, where most of the "easy to follow who's doing what" value lives); (2)
  **historical blame** - a toggleable git-blame overlay tinting objects by last author, off by
  default (a permanent border on everything is noise), decaying or on-demand so the arrangement
  stays readable. Open question: **role vs identity are two axes.** Today's colours encode
  *role* (you / agent / claude); multi-user adds an *identity* axis (an open set of people). An
  option is to keep the teal/violet/coral accents for role and assign each human a stable hue
  (hashed id into a curated palette) for presence/blame, defaulting the overlay to track/clip
  granularity and drilling to note/param on demand so a busy piano roll does not turn to confetti.
- **Concurrency model - keep the diff log, add a sequencer (leaning option).** A CRDT (Yjs/Automerge)
  is all-or-nothing: its value is *owning* the document and merging at that level, so adopting one
  means the store becomes a projection of its types and our authored command log stops being the
  source of truth. We want to **keep the diff model**, so the natural partner is not a CRDT but
  **server-authoritative event sourcing**: clients apply a command optimistically (instant local
  feedback, as today), a **sequencer** stamps it with a global order and rebroadcasts, and clients
  that had an in-flight optimistic op **rebase** it on top of the authoritative sequence. This is the
  smallest departure from what exists - the log just gains a server-assigned order plus a reconcile
  step - and it keeps one replayable, auditable log driving undo, history, and the two-voice feed
  (adopting a CRDT would split the source of truth). The architecture already has the two hardest
  prerequisites: **client-minted stable ids** (so concurrent inserts into a list never collide -
  the classic hard case, already handled) and coarse, intent-carrying commands. The cost we take on
  is owning the conflict *policy*: same-field edits resolve last-writer-by-sequence (intuitive), and
  the one genuinely hard case is an op referencing something another user just deleted (needs an
  explicit drop-or-resurrect rule - a small, enumerable set of command-vs-command interactions, not
  open-ended). Escalate to **OT** (Operational Transformation - keep our commands, add transform
  functions so concurrent same-object edits converge without clobbering) only if last-writer proves
  too lossy; correct OT transforms are notoriously hard to build and test, so it is a later
  escalation, not a starting point. Phasing unchanged: **presence-only first** (broadcast
  cursor/selection/identity, render the live colour model - ephemeral, cannot corrupt a project),
  then sequenced shared editing.
- **The one thing this trades away.** Sequencing gives *consistency* (everyone converges to the same
  state) but not the *automatic, offline-tolerant merge* a CRDT gives for free. For a DAW - where
  edits mostly land on different tracks/clips and live/online collaboration is the target - that is a
  good trade. The single scenario that would justify revisiting the store-as-CRDT fork is if
  **long-offline divergent editing that must merge cleanly** ever becomes a core requirement.
- **Libraries + the lock-in question.** Because we already own the command log (the expensive part),
  the sequencer itself is small - receive command, assign a monotonic seq, persist, fan out - so the
  honest ranking is by how much data-model lock-in each option imposes, which is a separate axis from
  the transport/hosting choice (transport is swappable; the framework is where lock-in lives).
  - *Least lock-in (leaning): own the protocol on a thin OSS layer.* Write the sequencer over a bare
    Node WebSocket server (`ws`), or **PartyKit** (MIT; a thin stateful-room framework), or Cloudflare
    **Durable Objects** directly. One room = one project maps perfectly and hibernates when idle. The
    room handler is a standard socket handler, so the platform is *hosting we can re-point*, not a
    data-model we are married to. We own the protocol and the log; nothing proprietary touches the
    document shape.
  - *Middle - an OSS sync library that keeps ops: **ShareDB** (MIT).* It is the mature
    keep-your-own-operations + OT server, self-hostable with pluggable pub/sub and storage. Downside:
    we adopt its JSON-OT type system and map commands onto it, and it is less actively maintained.
  - *Most turnkey, most lock-in - managed sync BaaS.* **Replicache/Zero** (Rocicorp) is the textbook
    optimistic-mutators + server-authoritative-rebase pattern and conceptually the closest match, but
    it is source-available/proprietary (free now) from one small vendor that has already moved to a
    successor - a real dependency risk. **Liveblocks**, **Convex**, **InstantDB** ship presence +
    storage fastest but each imposes its own data model (mostly a CRDT/store we do not need since we
    own our diffs) and, for the proprietary ones, its platform.
  - *Transport/hosting cost, once a framework is chosen:* a self-hosted `ws` process is cheapest if we
    run one small box; Durable Objects/PartyKit scale to zero (near-free at rest) at the cost of some
    Cloudflare hosting tie (not code tie). Avoid **raw AWS Lambda + API Gateway WebSockets** (room
    state lives nowhere; fan-out via DynamoDB + per-message billing is fiddly) and **WebRTC/`y-webrtc`**
    (needs a signaling server + TURN, no natural persistence, does not scale past tiny rooms).
  - *Presence*, note, needs none of this: who-is-online + cursors is a small ephemeral broadcast we can
    run over the same channel without any CRDT or sync framework.
- **First steps (if pursued), ordered by risk.** Do the irreversible, foundational work first while it
  is cheap, prove each layer with no network risk before adding the next, and defer the one piece that
  can corrupt data until last:
  1. **Real identity on the log.** Replace the role-based author stamp (you / agent / claude) with a
     stable per-person `authorId` + name + hue on every log entry and commit. This is the keystone
     everything reads, it is the expensive-to-retrofit bit (backfilling authorship you never stamped is
     painful), and per the no-legacy rule we just bump the format and stamp going forward. Delivers
     value single-user immediately (it is what the blame overlay needs).
  2. **Blame overlay (local) + `dispatch` seam audit.** Render "last author" from the log with no
     network. The real payoff beyond the feature: building it forces an audit that *every* mutation
     flows through `dispatch` - anything poking `ProjectStore` directly is invisible to the log and
     would be invisible to any future sync. Finding those holes now, offline, is far cheaper than
     debugging them later as merge desyncs. Highest-value de-risking step, zero infrastructure.
  3. **Presence only (first networked step).** An ephemeral broadcast of cursor / selection / identity
     over the chosen thin transport; render the live colour model. Carries no document state, so a bug
     can flicker a cursor but never corrupt a project. Biggest legibility win for the least risk, and it
     validates the transport + identity plumbing before any data rides on them.
  4. **Sequenced shared editing (the hard phase).** Add the sequencer: optimistic local apply +
     server-assigned order + rebase. Start with a small spike proving the rebase loop and the
     edit-vs-delete policy against our real command set, then wire per-user undo (undo *my* edits, not
     everyone's). Room = project maps onto the per-project bundles from slice 52, so persistence largely
     falls out.
- **How well it scales.** The model scales *on the axis that matters* and is naturally bounded on the
  risky one. **Total projects** is embarrassingly parallel: rooms are shared-nothing (a room never talks
  to another room), so they shard across processes / Durable Objects and scale to zero when idle - this
  is the axis a hosted product grows along, and it is the easy one. **Users per room** is the fan-out
  axis, and for a DAW it is naturally small (a band / session, single-digit to low-tens, not a
  hundreds-in-one-file livestream), so broadcasting each command to every peer is trivial and the
  single-threaded per-room sequencer (a Durable Object is literally one-threaded per object) is a
  feature, not a bottleneck - it is what buys a clean total order cheaply. **Per-room write rate** is
  low because commands are coarse and intent-carrying (a 64-note fill is *one* `add_notes`, not 64 ops)
  and human/agent editing is bursty-but-slow; continuous gestures (a knob drag) coalesce before they
  hit the wire. The one genuine scaling concern is **unbounded log growth per project**, and the
  mitigation already exists in the codebase: **snapshot checkpoints + keyframe/delta commit storage**
  (slices 15B / the undo checkpoints) mean a late joiner loads the latest snapshot and replays only the
  tail since it, never the whole history - so catch-up bandwidth and memory are bounded by snapshot
  cadence, not project age. The ceiling to name honestly: if a *single* project ever needed hundreds of
  simultaneous editors, the one-sequencer-per-room design would bottleneck and want something fancier -
  but that is not the DAW use case. Net: the primitives that make it scale (shared-nothing rooms,
  snapshot + replay-the-tail) are ones we already have for versioning, so concurrency reuses them rather
  than inventing them.

**Platform & form factor**

- **Touch-first affordances (design principle, apply now - not just for mobile).** Even before a full
  responsive layout, build interactions so they also work by touch, because retrofitting hover- and
  right-click-only UI later is expensive. Concretely: prefer **persistent ⋮ menus over hover-only
  kebabs**; always pair a **right-click context menu with a tap-reachable equivalent** (a ⋮ button, a
  long-press, or a mode); keep **hit targets generous** (glyph icons sized up, not tiny). This is the
  cheap groundwork that keeps the longer-term tablet / mobile goal (the Mobile / responsive bullet
  below) reachable without a rewrite, and it is why the timeline-usability batch above specifies a
  touch path for each new action.
- **Mobile / responsive layout (an epic; direction settled 2026-07-14).** The four-region video-editor
  grid assumes a wide screen; touch devices need a different shape. A concept mockup of the phone + tablet
  layouts lives at `docs/mockups/mobile-ux.html` (self-contained, open in a browser). Guiding decisions:
  - **Swap the shell, not the app.** The stores (`projectStore`, `editLog`, the param schema) and the
    leaf components (`PianoRoll`, `Knob`, `LibraryPanel`, mixer, agent) are already UI-agnostic. Only the
    desktop `[grid-area:...]` shell doesn't map. So below a breakpoint, render a `MobileShell` that
    re-hosts the same panels - mobile is another projection of the same stores, not a fork.
  - **Tier by device, don't build one "mobile."** Phone = play / tweak / **agent-driven** creation
    (not full arrangement editing by finger); tablet (esp. landscape + Pencil) = a genuine editing
    surface approaching desktop. Detect with `pointer: coarse` / `pointerType`, not just width.
  - **Navigation:** a thumb-reachable **bottom tab bar** (reuse the data-driven `ActivityRail` view
    list: Arrange / Edit / Mix / Library / Agent) + a **persistent transport bar** pinned top +
    **slide-up sheets** for transient tasks (add instrument, edit a param) so you don't lose your place.
    **Long-press replaces right-click** (no hover, no secondary click).
  - **The editing surfaces are the real work, and the keystone is migrating drag logic to the**
    **Pointer Events API** (`pointerdown/move/up`, one path for mouse/touch/Pencil, `touch-action:none`
    to own gestures) - do it once and every pointer surface benefits. Then layer: **pinch-zoom +
    two-finger pan** on both axes; an **explicit tool model** (draw / select / erase) to disambiguate a
    drag without modifier keys; **hit-target floors** (min note height + resize handles, fixed keyboard
    edge); heavier reliance on **grid snap/quantize**.
  - **Agent-forward is the mobile superpower.** Precise multi-track touch editing is inherently painful;
    describing intent is not. On mobile the agent shifts from assistant to the **primary creation path**
    ("add a four-on-the-floor kick," "harmonize in the project key"), with touch for auditioning and
    fine-tuning. Notes-as-prompt (play a phrase, attach it) is especially strong here.
  - **Platform gotchas:** iOS Safari / WKWebView has **no Web MIDI** (the on-screen keyboard/pads become
    the only input - invest there, velocity via touch-y/force); **AudioContext needs a user-gesture to
    unlock**; handle safe-area insets.
  - **Suggested sequencing:** (1) spike - render + navigate at phone width (`MobileShell` + tabs +
    transport); (2) Pointer Events refactor of roll/timeline/knobs (no desktop behaviour change); (3)
    touch gesture + tool layer; (4) agent-forward flow + on-screen keyboard/pads; (5) PWA packaging.

- **Native packaging - PWA first, then Tauri v2 (which now does mobile).** The real gating risk is not
  the shell tech but whether an **OS webview can deliver acceptable real-time AudioWorklet audio** on
  mobile - and that risk is shared by every webview approach (PWA, Tauri, Capacitor), since all three use
  WKWebView / Android WebView. So: ship a **PWA first** (installable, zero native shell, free) to validate
  webview audio on real devices and get an offline-capable app now; then **Tauri v2** for app-store
  presence + native niceties - it added first-class iOS/Android targets, so one Tauri project can cover
  desktop *and* mobile (a point in its favour over a native rewrite, which would abandon the shared web
  codebase). Tauri-mobile is younger than its desktop story and its mobile plugin ecosystem is thinner, so
  **Capacitor** is the fallback if Tauri-mobile plugins fall short (more proven web-to-mobile wrapper, same
  webview + audio caveats). Only reach for React Native / Flutter / native if the webview proves it can't
  carry the audio - which the PWA step will tell us cheaply.

**Longer horizon:** automation lanes (section 5); sharing / collaboration; Tauri desktop
shell (also the home for native low-latency monitoring and the fullest in-app IDE workflow), with
**Tauri v2 mobile** as the same-codebase path to the app stores (see the native-packaging bullet above).

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

## 16. User-authored instruments & the declarative DSP library (design thinking)

The ambition: a user (usually via an AI) designs their own instruments and effects, saves them
to a personal cloud library, shares them with friends/collaborators, and can publish to a public
library (with vetting). The hard constraint on the hosted platform: **untrusted DSP must not be
able to access anything by design** - not the page, not user data, not other instruments. This
section records the intended direction, the security reasoning behind it, and a principle for how
we grow DSP now. It is direction + options, not committed scope; deferred until the hosted
platform and user libraries exist.

### The direction in one line

Make the **declarative primitive graph the primary instrument/effect format** (data, not code),
cover as much as possible by **growing a curated primitive vocabulary**, and provide a **WASM
escape hatch** for custom DSP that is still safe to share. **Never run untrusted AudioWorklets on
the hosted platform** - raw worklets are for first-party DSP (via PR, reviewed) or local
self-hosting only.

### The maturity ladder (tiers)

1. **Presets over rich instruments (params only).** The AI picks parameter values against
   existing schemas. No new format, works today over MCP (a `save_patch`-style verb). Safe,
   limited ceiling (only sounds the current synths can make).
2. **Declarative primitive graph (data). <- the layer we invest in.** An instrument/effect is a
   JSON graph of curated primitives (oscillators, noise, filters, envelopes, LFOs, shapers,
   mixers, samplers, plus our own DSP primitives) with connections and a derived param schema.
   The trusted engine instantiates it (native Web Audio nodes + our WASM/worklet primitives).
   Pure data: safe online with no sandbox, validatable with zod, shareable/persistable as-is
   (nothing to execute), and a natural fit for the param-schema keystone (UI/MCP/automation/
   persistence all project from it, exactly like the catalog today).
3. **WASM custom DSP (the safe escape hatch).** For algorithms the vocabulary can't express,
   author custom DSP that compiles to a sandboxed WASM guest and appears as a primitive/leaf node
   in the graph. Safe to share (see security below).
4. **Raw AudioWorklet (first-party / local only).** Genuinely exotic DSP that needs worklet
   capabilities: authored by us via PR (reviewed, trusted) or run by a user on a locally-hosted
   instance. Never accepted as untrusted user-generated content on the hosted platform.

### Why declarative is the keystone-fit composition layer

The app's whole architecture treats the param schema as the keystone (UI, MCP, automation,
persistence are projections). A JSON primitive graph fits that exactly: it is introspectable data
with first-class params, the AI emits structured data against a schema (which LLMs do well), and
it persists/shares as pure data with **nothing to sandbox**. It also unifies local and online:
first-party instruments can be expressed in the same format, so Claude-in-Claude-Code and
online-Claude produce the same artifact; compiling a graph to a hand-written class becomes an
optional performance path, not a separate feature.

### Security: why worklets are out (for sharing) and WASM is in

- **AudioWorklet is capability-reduced, not isolated.** Its global scope has no DOM, no network,
  no storage - so it can't directly exfiltrate or touch the page. But it still runs in *our*
  origin and likely *our* process, with a high-resolution sample clock (a side-channel /
  fingerprinting foothold), a realm shared across all processors on a context (prototype
  pollution / interference), a real-time thread it can busy-loop to DoS the whole mix, and a
  message port whose safety depends on our main-thread handling. Acceptable for self-authored
  personal code; unacceptable for one user's code running in another's browser.
- **WASM is deny-by-default by design.** A module operates on its own bounds-checked linear
  memory - no pointers outside its own buffer, so it cannot reach the JS heap, DOM, storage, or
  other instruments. It has zero ambient authority: it can only call the imports we inject, and
  no I/O exists unless granted. Architecture: a small **trusted worklet shell** (we author, audit
  once) instantiates the **untrusted WASM guest**, copies audio + params into its sandboxed memory
  and audio back out, and grants a minimal import set (math only; no message port, no clock, no
  SharedArrayBuffer). The user/AI writes only the guest, never the shell. That inversion (deny
  everything, grant a tiny explicit surface) is the "can't access anything by design" property.
- **Residual risks WASM doesn't fix, and how we contain them.** CPU/DoS (a bad guest can still
  glitch audio) - run untrusted instruments on a **dedicated AudioContext**, route their output
  back into the mix, and watchdog the render, tearing the guest down on overrun/throw. Timing
  side-channels - **withhold the high-res clock and SharedArrayBuffer** from the guest, removing
  the practical primitives. Net: WASM makes data access safe by construction; isolation + watchdog
  handle CPU; withheld imports handle timing.

### Faust: the factory and compile target, not the user-facing format

The **declarative graph** (tier 2) and **Faust** (a mature functional DSP language that compiles
to WASM) are different layers, easy to conflate. Use Faust, but do not adopt it as the
composition format:

- **Keep our own declarative format** as the composition/sharing/keystone layer. It is data
  (shareable with nothing to sandbox), introspectable, param-schema-native, and gives us control
  over UX, automation, and how instruments compose - none of which a compiled Faust blob offers
  (params bolt on via metadata; it is opaque code, one monolithic WASM per instrument, a parallel
  runtime to our node graphs).
- **Lean on Faust as the primitive factory.** Rather than hand-writing each custom primitive
  (ladder filter, reverb, pitch-shifter) as a bespoke worklet, author them in Faust and compile
  to WASM primitives that slot into the vocabulary. Faust's standard library already holds a huge,
  battle-tested catalog (filters incl. Moog ladder / SVF, oscillators, reverbs, physical models,
  effects), so this fills the vocabulary far faster and safer than bespoke worklets, without users
  ever seeing Faust.
- **Faust is also the natural tier-3 compile target** for user/AI custom DSP: a constrained DSP
  language (it can't even express I/O - a safety layer above the WASM sandbox) that LLMs write
  competently. Compile server-side in a hardened build sandbox to a validated `.wasm`; clients
  only download and run the finished module.
- Option to revisit later: compiling our graph format down to Faust (one WASM runtime, two
  authoring levels) unifies the runtime but couples the simple path to the compiler and loses the
  native-node / pure-data-no-compile properties. Deferred; the hybrid (native nodes + WASM
  primitives, our own format) is the current lean.

### The shell contract determines what is precluded (design it richly)

Because WASM matches worklets on DSP algorithms, the only things "no untrusted worklet" costs us
are capabilities we choose not to expose through the trusted shell's fixed contract. So invest in
a rich contract: **params in** (the schema); **musical/transport context in** (tempo, beat/bar
position, time signature, sample rate, block time) so tempo-synced devices work; **note/event
in**; **multi-channel audio in/out including a sidechain/keyed input**; a **bounded
analysis/visualization out** region (meters, scopes, tuners, spectrum) the shell forwards to the
trusted UI; and **control-rate signals + modulation routing** in the graph (analysis -> param,
LFO -> param, envelope -> param), not just audio flow.

What remains genuinely precluded from untrusted content (and routes to PR/local): bespoke
bidirectional UI protocols beyond the contract, exotic I/O the contract doesn't expose, anything
needing SharedArrayBuffer / threads / self-timing, and GPU/neural inference (inherent to the audio
thread - no worklet or WASM audio code gets the GPU; that lives in trusted main-thread/worker
code). These are plumbing, not sounds: any instrument or effect algorithm is expressible; an
arbitrary plugin-with-its-own-runtime is not.

### Custom UI: also declarative, a projection of the schema

The UI is already a projection of the param schema (instrument panels render from param specs),
and custom instruments should inherit that rather than ship their own code. Three levels, mirroring
the DSP tiers:

- **Auto-generated from the schema (default).** A user instrument declares its params (name, range,
  unit, kind, grouping, control-type hint) and the app renders a consistent, accessible panel
  automatically. This is what most instruments need, and it is pure data - the same reason MCP,
  automation, and the AI can all see and drive the instrument. (Faust's own UI metadata - groups,
  sliders, knobs - maps straight onto this.)
- **Declarative layout + a curated widget palette.** For richer panels, a layout description
  (sections, positions) referencing trusted widget types from a palette: knob, fader, XY pad,
  envelope editor, step sequencer, wavetable / scope / meter display. Live-data widgets (scope,
  spectrum, meter, tuner) bind to the **bounded analysis-out channel** from the shell contract -
  the DSP writes analysis into a bounded buffer and a trusted renderer draws it. Still pure data to
  place; nothing the author wrote executes.
- **Arbitrary UI code: same policy as worklets.** Hand-written HTML/JS/canvas is untrusted code
  touching the DOM - out for hosted/shared instruments (first-party via PR, or local only). Beyond
  safety, arbitrary UI would fracture the keystone: a custom panel could hide params from
  MCP/automation/the AI. Keeping UI declarative is what keeps instruments fully agent-controllable.

Symmetry worth keeping: **DSP is a graph of curated primitives; UI is a layout of curated widgets;
both bind to the same param schema; both are pure data; both grow by adding trusted building
blocks.**

### Principle to adopt now

Even though the platform is future, bias new DSP work this way today: **grow the reusable,
composable primitive vocabulary rather than writing a one-off worklet per instrument, and keep
DSP as pure, parameterized modules** (as `dsp/ladder`, `dsp/oscillators`, `dsp/wavetable` already
are - thin realtime shells over pure DSP). Prefer general primitives that compose (a pitch
shifter + a pitch detector + a scale quantizer) over special-purpose features (an "autotune
node"), because the general ones recombine into many devices.

### Worked example: autotune

Autotune = pitch detection + snap-to-scale + pitch shifting. None of these are native Web Audio
nodes, so it is **not** expressible in a native-only graph. It **is** expressible in the
declarative format once the vocabulary includes three reusable primitives: a **pitch detector**
(autocorrelation / YIN or FFT) emitting a control-rate f0; a **scale/pitch quantizer**
(control-rate: detected pitch + key/scale + retune-speed -> target shift); and a **pitch shifter**
(phase vocoder or PSOLA). Wired: input -> pitch-detect -> quantize(key, scale, speed) ->
pitch-shift(amount) -> output, with params for key, scale, retune speed, and mix. This needs the
control-rate connections above, and it is the poster child for the principle: those same three
primitives also compose into a harmonizer, an octaver, formant correction, and a vocoder - so we
add capabilities that recombine, not a bespoke autotune device. Each primitive is a WASM leaf
(Faust-authored), safe to ship and share.

### Adoption & sequencing (recommendation)

Adopt the model as direction now, but do not big-bang it:

- **Now (zero-cost):** the principle above - new DSP as reusable pure modules / candidate
  primitives.
- **Prove with a vertical slice, not a rewrite:** build the graph runtime + schema + auto-UI and
  express one or two of the simplest existing instruments in it (Subtractive, FM - purely native
  nodes), validating format + UI projection + params + persistence + MCP end to end on real
  instruments. Keep the rest as-is; a declarative instrument is just another cataloged type whose
  factory is the graph interpreter, so the two systems coexist behind the `Instrument` interface.
- **Grow demand-driven:** convert more instruments (and grow the primitive vocabulary) only as the
  format earns it - when user authoring is real, or when a new instrument is genuinely easier as a
  graph than a class. Populate primitives from real instruments + Faust's stdlib, not a speculative
  list.
- **Defer the heavy bits** (WASM/Faust pipeline, UI layout language, sandboxing) until the hosted
  platform and sharing are actually on the table. The native-node graph + schema-projected UI is
  the cheap, high-value core; sandboxing is only needed once untrusted code / sharing exists.

Not recommended: converting all instruments now. The current ones work; conversion is churn and
regression risk with no user-facing benefit today; and Nimbus/wavetable need the WASM-primitive
path (more infra) regardless. Let real use, not speculation, drive the buildout.

### Status

Direction and options, not committed scope; deferred until the hosted platform and user libraries
exist. The near-term, no-regret move is the principle above (reusable pure DSP modules; general
primitives), and - when the declarative graph is built - making tier 2 the format first-party
instruments are themselves expressed in, so local and online authoring converge on one artifact.

## Sync service (server + database)

Motivation: browser storage (OPFS/localStorage) was evicted by Chrome and wiped projects. We
graduated to **web-app-primary**: a server + Postgres is the durable source of truth, OPFS is the
offline fallback, and bundle export/import (`.daw.zip`) stays as the portability escape hatch.

- **Server + DB behind the `BundleStore` seam - DONE (slice sync-service).** A Hono + Drizzle +
  Postgres service (`server/api`, `server/db`) is a thin, owner-scoped `(projectId, path) ->
  content` store; the client's `RemoteBundleStore`/`RemoteProjectStorage`
  ([src/audio/remoteStore.ts](src/audio/remoteStore.ts)) plug in via `getProjectStorage()` when
  `VITE_DAW_API_URL` is set, so nothing above the seam (repository, library, autosave) changed.
  The client gets typed endpoints from the server's Hono RPC type (`hc<AppType>`, a runtime-erased
  type import) - the JSON control routes; file bytes go over plain `fetch`. Sync timing is the
  existing autosave: a ~300 ms debounce after any edit, plus commits, sample imports, and renames;
  reads on load and project switch. Last-write-wins, no conflict engine.
- **Trust & durability guarantees.** Projects **soft-delete** (a `deletedAt` stamp, never a hard
  `DELETE`) so an accidental delete is recoverable; `history/commits/*` is **write-once**
  (append-only). Auth is stubbed for now: a shared bearer token + a single hardcoded owner, with
  every query owner-scoped so real accounts are a change of principal, not of schema.
- **Typed storage + a "don't trust the client" boundary - DONE.** JSON bundle files are stored as
  Postgres **`jsonb`** (readable and queryable in Drizzle Studio / psql, not opaque bytes; samples
  stay `bytea`, a CHECK enforces exactly one). Every JSON write is **shape-validated** against a
  per-path zod schema (`server/api/bundleSchemas.ts`) before it reaches the DB - malformed JSON is
  400, wrong shape is 422. The validation is deliberately **structural** (top-level type + always-
  present fields, with zod's default key-stripping so evolving fields don't break saves); deep
  per-parameter validation stays at the client/MCP boundary where the param schema lives. A test
  runs a real project snapshot through the schemas to guard against over-strictness.
- **Migrations - the paradigm shifted, and it is now in force (slice 81 deploy).** The old "discard
  old data on a format change" shortcut was scoped to disposable local-only data. With the app now
  **deployed to a live hosted database** (Fly + Neon), that shortcut is **retired**: there is real
  persisted user data, so every schema change must carry it forward. **Migrations are forward-only and
  additive-preserving** - we never discard or reshape data destructively in place. Two independent axes:
  - **DB schema (Drizzle):** edit `server/db/schema.ts` -> `yarn db:generate` (versioned SQL in
    `drizzle/`) -> deploy. `applyMigrations` runs pending SQL **on boot**, idempotently. Because a
    migration runs while the previous machine is still serving (rolling deploy), new SQL must be safe
    against the running code too, so a destructive change (drop/rename) is done **expand -> contract**
    across two deploys, never in one.
  - **Project document (`project.json` / command blobs, opaque to Drizzle):** bump `PROJECT_SCHEMA` +
    add a `fromVersion -> fromVersion + 1` upcaster in `src/audio/project/documentMigration.ts`;
    `ProjectRepository.load` chains them and heals each bundle lazily on load. CI fails on a gap
    (`firstMissingUpcaster`); `findStaleProjects` flags stored docs below the current version.
  - **Safety:** Neon keeps point-in-time history; take a **Neon branch** (copy-on-write clone of prod)
    as a rollback point and test a risky migration against it before deploying. Operational runbook:
    `docs/DEPLOY.md` ("Migrations on a live database").
  The "discard on change" mindset (still referenced in the older local-only notes above and in the
  slice-70 dev-DB refresh) applied **only** while data was disposable; it does not apply to hosted data.

**Roadmap (deferred):**

- **Offline-first / PWA.** Today it is remote-*or*-local; a set `VITE_DAW_API_URL` with the server
  down means writes fail. The next step is a **local cache + queued writes**: keep OPFS as the
  working copy, queue mutations while offline, and flush to the server on reconnect (last-write-wins
  per file, with the commit DAG as the reconciliation story). That plus a service worker + manifest
  makes it an installable **PWA** that works offline and syncs when back online.
- **Real accounts** (OAuth) replacing the stubbed token/owner; **object storage** (S3/R2) for large
  samples instead of `bytea`; **realtime** (SSE for cross-device change nudges first, WebSocket/CRDT
  for true multiplayer) - all fit behind the current seams.
- **Agent-session persistence.** Agent chat (`ChatTurn` via `src/ui/agentSessions.ts`) is
  `localStorage`-only and **global** (cross-project) today - the same evictable storage that motivated
  the sync service, so it is the next durability gap after project data. Move it behind the sync seam as
  its own session-scoped store (`agent_sessions` + `agent_turns`, keyed by session id, not by the
  project's edit `seq`). Two decisions to settle when picked up: per-project vs global scoping (currently
  global - the agent re-reads project state each turn, so a conversation can span projects), and
  transcript size/privacy (tool-call payloads get large and are more sensitive than project data). This
  is a **distinct** stream from the project's authored edit-log: chat is the reasoning transcript that
  *produces* edits + feed notes; do not fold agent turns into the project edit-log.
- **Delta sync - _done_ (slices 66-67).** Autosave no longer re-uploads the whole `project.json` on
  every edit; it **appends the delta** to a durable, append-only edit log and rewrites `project.json`
  only as a throttled **keyframe** (recording, via a `headSeq` marker, the seq it reflects). Load
  reconstructs HEAD by replaying the log tail after the keyframe through `applyEdit` (the same
  keyframe+delta shape the commit DAG uses). The edit log is exposed through the storage seam
  (`BundleStore.appendEdits`/`readEdits`): local backends back it with an `edits.json` file, the sync
  server with an `edits` table (`POST`/`GET /projects/:id/edits`), so per-edit network cost is
  proportional to the edit, not the document - parity with local saving. The log is a MUTABLE working
  stream (append upserts by `seq`) so a coalescing edit (a knob drag) re-syncs; undo/redo force a
  keyframe so the replayed tail is always pure-forward. The **append core is exactly what the future
  WS `edit` message reuses** (HTTP now, WS with multiplayer). Known limit: a coalescing edit still in
  the un-keyframed tail may reload at an intermediate value after a hard crash mid-drag; the next
  keyframe heals it.
  - **Keyframe cadence - _done_ (slice 69).** The initial cadence fired a full-bundle keyframe ~1.5s
    after edits stopped (idle-triggered), re-introducing whole-bundle writes after nearly every editing
    pause. The rework rests on one insight: **keyframes are not a durability mechanism** (the delta
    append is the durable write) - their *only* job is bounding load-time replay, which is cheap. So the
    cadence is now **count-primary**: `project.json` is rewritten every `KEYFRAME_EDIT_INTERVAL` edits
    (100 to start, a single tunable constant, expected to rise once large-project testing shows the real
    assemble-vs-write crossover), plus the existing undo/redo-forces-keyframe (an unreplayable entry in
    the tail), and the periodic idle timer is gone. The small files are **unbundled** from the keyframe:
    `notes.json` is written on the fast cadence (on change) and `meta.json` on the keyframe cadence, so
    feed notes and the modified-time no longer wait for a rare keyframe. A **page-hide flush**
    (`visibilitychange`/`pagehide`) sends whatever the debounce is still holding (a fast edit burst never
    pauses long enough to append) plus notes + a meta touch; it deliberately does *not* keyframe (the
    payload stays small and reliable, and `project.json` is rebuilt by replay next load).
  - **Feed + edit-log unification - _done_ (slice 70).** Feed notes and edits are now **one**
    seq-ordered authored stream. A note is a `kind:"note"` entry carrying its text on `command`
    (`{type:"note", text}`); forward replay skips it (only `edit` kinds apply). So notes ride the delta
    append (durable without a keyframe) and both `notes.json` and `log.json` retire - killing the
    `log.json`/`edits`-table duplication the earlier inspection found. The stream is the single feed
    source: local backends keep it in `edits.json`, the sync server in the `edits` table; load reads a
    bounded recent window (`readEdits` gained a `limit`; `KEYFRAME_EDIT_INTERVAL` << the window, with a
    guard that reads the full tail in the unlikely case it doesn't reach the keyframe). The in-memory
    `EditLog` API is unchanged - the edits/notes merge and split live at the persistence boundary
    (`ProjectRepository`). Old bundles: pre-unification `log.json`/`notes.json` are **not** read back -
    the local dev DB was refreshed by explicit consent (the sync service still holds only disposable dev
    data; there are no real users yet), so a one-time discard was preferred over carrying transition
    code. The forward-migration discipline (CLAUDE.md) resumes for changes made once real data exists.
    `.daw.zip` export/import uses the unified `edits.json`.
  - **Commits referencing edit ranges instead of embedding entries - deferred, gated on the
    authoritative log.** A commit currently embeds its `entries` (a copy of the edits it bundles),
    which duplicates rows the `edits` table also holds. A commit could instead store just a seq range
    (`fromSeq..lastSeq`) and resolve the entries from the stream. But the two layers have *opposite*
    lifecycles today: the `edits` table is a **mutable, prunable working stream** (coalescing upserts;
    compaction is a future item), while commits are **write-once and kept forever**. Embedding is what
    makes a commit self-contained and independent of that stream; referencing would make committed
    history hostage to the working stream's lifecycle (a pruned/rewritten seq dangles a commit). It is
    also a small win - edit commands are tiny; the bytes that dominate the history file are the keyframe
    **snapshots**, which are materialized state not present in the `edits` table and so can't be deduped
    this way. The right time is the **authoritative-server / multiplayer** slice: there the `edits`
    table stops being a per-client mutable stream and becomes the canonical, server-assigned,
    append-only log, at which point "commits are markers/ranges into the one log" is the clean model
    (the feed + commit DAG genuinely merge). Doing it before then bolts immutability onto a stream
    designed to be mutable. So: unify commits with the edit-log when the log becomes authoritative, not
    before - and even then it mostly de-dupes the cheap part, so it is model cleanliness more than
    storage savings.
  - **Snapshot-anchor dedup - deferred (low priority).** Full `ProjectData` snapshots live in three
    places: `project.json` (the HEAD keyframe), `undo.json` (`undo.base` + `redo.base`, the delta-encoded
    stacks' anchors), and keyframe commits. These are *materialized state*, not edits, so they are the
    real weight in a bundle - but they are mostly not literal duplicates: each is a distinct point in
    time (HEAD, the ~30-edits-back undo floor, a redo anchor, historical commit points). They exist as
    stored anchors because `applyEdit` is **forward-only** - with no inverse you cannot derive a past
    state by walking HEAD backward, so a state you want to restore must be stored (or reconstructable by
    forward replay from a stored anchor). `undo.json` already delta-encodes (one base per stack + the
    commands, not ~30 snapshots) and is bounded to `PERSIST_UNDO_DEPTH`. A future "anchor management"
    pass could share anchors where points coincide (e.g. an undo base that lands on a commit keyframe)
    or reconstruct undo/redo from the reflog, but the win is small and it needs care - not worth it until
    snapshot storage is shown to matter.
  - **Server-side keyframes / compaction - converges with multiplayer.** The client currently
    materializes and uploads keyframes. A server could instead build them by replaying the `edits`
    table itself, so the client only ever POSTs deltas. This is feasible (`applyEdit` is app TS that
    drives `ProjectStore` mutators and could run in Node) but **breaks the deliberately-dumb
    `(projectId, path) -> content` blob store**: the server would have to own the command/reducer
    layer *and* the document upcasters (to replay a versioned command stream), i.e. project semantics
    and versioning both move server-side. It is not worth that coupling for single-user autosave -
    the cheaper win is simply keyframing rarely on the client (above). It becomes worth it exactly
    with **realtime multiplayer**, where an authoritative server must replay and merge edits to
    broadcast `editApplied` anyway - the replay engine stops being extra coupling and becomes core.
    So server-side keyframing (and edit-log compaction) is best built *with* the multiplayer slice,
    not before it. The `BundleStore` seam already permits a "smart backend" variant when that lands.
- **Document-schema drift detection - _done_ (slice 68).** Two version axes exist and only one is
  covered by DB migrations: drizzle-kit versions *table shape* (DDL), but the `project.json` /
  command payloads live in `jsonb` blobs it cannot see, so a `PROJECT_SCHEMA` bump would let stored
  documents drift below the current version silently. Two cheap guards close that (upcasting stays
  lazy-on-load in `documentMigration.ts`, which also serves OPFS/local + `.daw.zip` import, so the
  logic deliberately stays in shared TS rather than server-only SQL): (a) **detectability** -
  `findStaleProjects(db, currentVersion)` reads the `projects.project_schema` column (backfilled from
  `manifest.json` on every write) and the API logs a startup warning listing any below the current
  version; (b) **build-time honesty** - `firstMissingUpcaster` asserts the upcaster registry chains
  contiguously up to `PROJECT_SCHEMA`, so bumping the schema without the matching upcaster fails in
  CI instead of stranding old data. Deferred until the first actual bump: an **eager data-migration**
  that heals stored blobs by reusing the same upcasters (there is nothing to heal until then).
- **Canonical shared project schema - _done_ (slice 63, Phase 1).** The shallow, hand-written
  structural guard is replaced by a single pure-`zod` module, `src/audio/project/schema.ts`, that is
  the source of truth for the document types: the client derives its TS types via `z.infer` (the old
  hand-written `ProjectData` interfaces are gone, re-exported from the schema through
  `project/types.ts` so the ~14 importers are unchanged), and the sync server validates writes against
  the *same* `validateBundleFile` - `project.json` is now deep-validated down the tree, with no drift.
  It composes `graph/zod`'s device schemas for embedded custom devices and cooperates with the
  `documentMigration` upcasters (upcast an old-version doc, then validate at the current version). The
  `EditCommand` union stays structural for now (a ~50-variant wire-coupled union); deep per-param and
  per-command validation are deferred (below).
- **Contract-first API - _done_ (slice 64), the chosen architecture superseding `hc`.** The server's
  destination is a WebSocket realtime multi-user service, not fixed HTTP endpoints, so the API type
  story moved from Hono RPC (`hc` + a `type AppType` import) to a **plain-data `zod` contract** in
  `src/contract/`: route descriptors (`http.ts`) + WS message discriminated-unions (`ws.ts`) + shared
  param/error schemas (`errors.ts`), all referencing the canonical schema, plus a browser client
  (`client.ts`: `createApiClient` + a typed `createWsClient`). Both client and server import the
  definition normally (no type-import-through-the-server-graph, so the DOM-free-boundary hack for
  `AppType` is gone). The server *mounts and validates from* the contract (`app.ts` sources its paths +
  param schemas from `routes`); the client's `RemoteProjectStorage`/`RemoteBundleStore` are thin
  adapters over `createApiClient`. One definition, many consumers, no drift. The file routes stay a raw
  byte-transfer descriptor (json/binary by path), keeping the generic `BundleStore` seam one format.
  Reason `hc` was dropped: it types HTTP routes but not bidirectional WS payloads (the actual
  destination), and contract-first also removes the type-import coupling. ts-rest does contract-first
  for HTTP but has no WS; tRPC has WS but is inference-shaped/heavy - so the thin contract layer is ours
  (small: `zod` unions + `z.infer` give most of it).
  - **Deferred deliberately (not built, to avoid speculative work for absent consumers):** (a) a
    **generated OpenAPI doc** - the shared contract already gives TypeScript consumers types +
    validation + a readable accept/reject spec, so OpenAPI only earns its place for a *non-TS* consumer
    (a future mobile app, a partner, a public API); it is a ~10-line generator (`z.toJSONSchema` over
    `routes`) to add when one appears. (b) the **live WS socket server + message dispatcher** - the WS
    *contract* (message unions, parse helpers, typed `createWsClient`) ships now, but standing up an
    actual socket listener is transport plumbing tied to multiplayer (and needs a WS adapter dep), so
    it lands with the conflict-resolution work, built on this contract.
- **Deepening validation is gated on catalog versioning (sequence).** Deep per-param and built-in-device
  validation are deliberately deferred: built-in instrument/effect schemas live in the client catalogs
  (not the document), and the client is coercion-tolerant and versionless by design, so strict
  server-side param validation would risk rejecting data the client considers valid. The safe path is
  a **`catalogVersion`** stamped in the manifest on write; the server ships the catalogs + its version
  and deep-validates params only when versions align, else falls back to structural (skew becomes
  detectable and handled, never a silent wrong rejection). This has independent value (reproducibility;
  a "your app version lacks this sound" UX). Order: **custom-device params** (zero coupling - the schema
  is embedded in the document) -> **catalog versioning** -> **built-in params** -> deep `EditCommand`.
  Full declarative conversion of built-ins is the separate gated declarative-DSP initiative (section
  16), not a validation lever (built-ins would still be referenced by id from a shared catalog).
- **Realtime multiplayer - chosen strategy (design decided; build underway).** Live multi-user
  editing. The transport, authority, conflict model, and offline stance are settled below.
  - **Build progress.** Phase A is landing in two slices. **A1 (slice 71, done):** the server-side
    per-project authority - a `Room` (server/api/rooms.ts) holds a headless `ProjectStore`, assigns the
    single monotonic `seq`, applies via `applyEdit`, persists through the existing `appendEdits`, and
    broadcasts `editApplied`; a `WebSocketServer` on the same HTTP port (`/ws`, token at the upgrade)
    is the transport glue. Idempotent by `opId`; reloads HEAD from Postgres by replay on restart.
    **A2 (slice 72, done):** the client `SharedSession` (src/audio/sync/sharedSession.ts) - optimistic
    apply + total-order rebase. It keeps a confirmed `base` (advanced by `applyEdit` in `seq` order) and
    a `pending` list of unconfirmed local ops; the live store is `base + pending`. Its own `editApplied`
    just retires the pending op (live already matches); a peer's advances `base` and **rebases** (rebuild
    live as `base` with `pending` replayed on top). Wired through a single `EditLog` remote-sink so UI /
    MCP / recorder / agent edits all forward automatically; enabled whenever a remote backend is
    configured (`VITE_DAW_API_URL`), where the client stops HTTP autosave and the authority persists.
    Undo/redo stay **local best-effort** in a shared session (their snapshots predate a rebase).
    **A3 (collaboration completeness, done) - A3a (slice 73, done):** per-user identity + colours.
    `author` generalised from the 3-role enum to a bounded free string (`claude`/`agent` reserved AI
    voices, `you` the default; any other value a human user id) - backward compatible, no schema bump.
    A `currentUser` store (localStorage + `?user=` override, dev-only setter in the Authors settings tab,
    removed once real auth supplies the id) sets `EditLog`'s local-author default, so UI edits carry the
    user id (MCP/agent still stamp their own). A peer's `editApplied` now posts an append-only feed entry
    via `EditLog.recordRemote` (narration, no re-apply), and the activity feed colours each entry by
    `colorForAuthor` (any id -> a stable hue) instead of collapsing to three voice classes. **A3d (slice 74, done):** full
    per-surface tinting + **perspective-relative colouring**. The author-tinted surfaces (piano-roll
    notes, knob/fader fills + pointers, arrangement placement blocks + note-summary bars, track-row
    accents, clip rail, patch list, version timeline, feed) moved off the fixed 3-voice Tailwind classes
    (authorVoice.ts) onto per-author inline hex (authorStyle.ts), fed a live `{config, self}` presence
    through an `AuthorColorsProvider` context so a swatch/identity change recolours instantly. Colour is
    **perspective-relative**: `colorForAuthor(author, config, self)` paints the viewer's OWN edits with
    the teal "you" hue (whoever they are) and every collaborator in their own stable hashed hue;
    `agent`/`claude` stay absolute voices. This removed the asymmetry where whoever kept the default `you`
    was a privileged always-teal identity others couldn't recolour - now two users are symmetric (each
    sees itself teal, the other in a distinct, recolourable colour). The Authors settings tab lists
    **collaborators seen in the feed** (excluding the AI voices + self), each with its own swatch picker.
    authorVoice.ts trimmed to the reserved-voice constants + label.
    **A3b (slice 75, done):** project name is now project state - a `renameProject` edit
    (`ProjectStore.renameProject`, an optional `name` on `projectDataSchema`) instead of a bare
    `meta.json` write, so a rename syncs live across a shared session, rides undo/redo + history, and the
    authority's headless replay reconstructs it. `meta.json` keeps a name copy as the library's list
    index. A document with no `name` defaults to "Untitled" (the dev DB was cleared to drop pre-A3b
    projects rather than carry a meta-heal, per the disposable-dev-data consent - no `PROJECT_SCHEMA`
    bump). The header title reads the name from the store (`useProject`) so a peer's rename updates it in
    real time.
    **A3c (slice 76, done):** reconnect gap-fill - a dropped connection self-heals. `createWsClient` now
    reconnects with capped exponential backoff after an unexpected close and exposes an `onOpen` hook that
    fires on every (re)connect. `SharedSession.resync` (bound to `onOpen`, and the single path the initial
    subscribe rides too) re-subscribes - the authority's `snapshot` folds any edits missed while away (the
    gap-fill) - and re-sends every still-pending optimistic op. Re-sends are idempotent by `opId`: the room
    now *broadcasts* an already-applied re-echo (rather than returning it silently) so the originator retires
    its pending op, and peers drop it via their reorder guard. `onEditApplied` retires a pending op on any
    `opId` match, even when its echo trails a snapshot that already folded it into `base`. This closes A3
    (collaboration completeness); next is the auth + real-users epic below.
  - **Auth + real users/sharing (the current epic, before Phase B/C).** Today auth is stubbed: one
    hardcoded owner `"local"` + a shared bearer token, so "two users" are the same account. This epic
    makes multi-user genuine and is the gateway to the rest. We adopt **Supabase Auth as an identity
    provider only** - it runs login and issues a JWT; our Hono+Postgres owns all domain data and just
    *verifies* the token to get the principal. Lock-in is kept low deliberately (a decision with the
    user): the DB stays plain Postgres (Drizzle unchanged), we keep our **own `users` table** keyed by
    the auth subject (never FK into Supabase's tables), verification is a standard JWKS check behind a
    one-function seam, and we use none of Supabase's realtime/storage/data-API - so moving to AWS
    (RDS + Cognito or self-hosted GoTrue) later is a contained swap. Sliced A/B/C:
    **Auth-A (slice 77, done):** the server-side principal, end to end. New `server/api/principal.ts`
    seam (`makeJwtResolver` verifies a Supabase JWT via `jose`/JWKS - issuer + `authenticated` audience,
    principal = `sub`; `makeDevResolver` keeps the pre-auth shared-token + single-`"local"`-owner stub
    for local dev/tests). Both the HTTP middleware (`app.ts`) and the WS upgrade (`wsServer.ts`) resolve
    identity through it (WS is now a *per-connection* owner; the message handler awaits the resolved
    principal so an early `subscribe` is held, not dropped). A resolved principal is JIT-provisioned into
    a new `users` table (`ensureUser`, `onConflictDoNothing`); `projects.ownerId` is now an FK to
    `users.id` (+ an owner index), and `Room.load` also `ensureUser`s so the authority satisfies the FK
    for any caller. Bootstrap reads `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER` (unset -> dev-stub). No
    client change (Auth-B wires the real token). Tests mint tokens against a local JWKS (no network/live
    Supabase). **NOTE - authentication only:** per-project *authorization* (may this user open this
    project?) still needs the membership model and lands in Auth-C; until then the owner is the only real
    user and there is no login UI, so nothing can exploit it yet.
    **Auth-B (slice 78, done):** the browser login. New `src/auth/session.ts` (the only importer of
    `@supabase/supabase-js`) wraps Supabase Auth behind two seams: `getAccessToken()` (the credential for
    the clients - the live session JWT, or the static `VITE_DAW_API_TOKEN` when auth is off) and a
    `readAuthState`/`subscribeAuth` store fed by `onAuthStateChange`. `src/ui/AuthGate.tsx` wraps
    `AppShell` in `App.tsx`: when `authEnabled` (both `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set)
    it shows a loading card / a login screen (Continue with Google/GitHub, styled like `StartDialog`) /
    the app by session status - gating *above* AppShell so the audio engine doesn't build behind the
    login. The token became a lazy `TokenSource` (`string | (() => string | undefined)`) on
    `createApiClient` (per-request `authHeaders()`) and `createWsClient` (URL rebuilt inside `connect()`,
    so a reconnect picks up a refreshed token); `RemoteProjectStorage`/`bundleStore`/AppShell feed
    `getAccessToken`. On sign-in the gate bridges the session's display name into `currentUser` (author =
    a readable name, deliberately distinct from the server principal = JWT `sub`); the A3a dev identity
    field in `AuthorColorSettings` is now auth-aware (static name + Sign out when authed, editable handle
    in dev). Auth composes with the existing `VITE_DAW_API_URL` gate; local/OPFS mode ignores tokens.
    Tested: `test/client.test.ts` (the token-getter is evaluated per request); the gate/login/supabase
    wrapper are verified live (client runs in Vitest's node env - no jsdom - so no component tests).
    **Auth-C (slice 79, done):** **membership/sharing** end to end. New `project_members` table
    (`(projectId, email)` PK, role, invitedBy) - a member is keyed by **email** (the invited identity,
    stored lowercase), never a FK into `users`, so an owner can invite someone who hasn't signed up yet
    and the grant takes effect the moment they sign in with a provider account whose verified email
    matches. The single-owner filter in `server/db/store.ts` became **owner-or-member**: an `accessibleWhere`
    predicate (`ownerId == me OR EXISTS a member row for my token email`) drops in wherever a query was
    `eq(ownerId)`; writes gate the same way (create-if-absent still owner-stamps, but a member's write never
    re-stamps the owner). Owner-only member endpoints (`GET/POST/DELETE /projects/:id/members`, zod
    `z.email()` at the boundary) + a `SharePanel` reached from the project menu (shown only for a project
    you own). This also **closed the WS room-authorization gap** flagged in Auth-A: `RoomRegistry.get` now
    takes the principal, resolves the project's *real* owner from the table, authorizes owner-or-member
    before handing back the room, and loads/persists the room under that real owner - so a shared project
    is one room keyed by `projectId` and a member's edits persist under the owner (an unauthorized subscribe
    is refused, closing 1008). And the **project index moved onto the `projects` table**: `GET /projects`
    returns `{ id, name, modifiedAt, role }[]` (the `ProjectStorage` seam's `listProjectIds -> listProjects`),
    killing the per-project `meta.json` read on the remote path.
    **Auth cleanup (slice 80, done):** the Auth-C follow-ups + a polish. (a) **Retired `DAW_API_TOKEN`**
    end to end - `makeDevResolver` keeps only the `"local"` dev principal (open locally; production always
    sets the JWT config), and `VITE_DAW_API_TOKEN` is gone (the client sends the Supabase JWT or nothing).
    (b) **Email-based edit identity** - `author` (the colour key + feed label) is now the signed-in
    **email**, not the display name, so two logins of the same person stay distinct; the feed shows "You"
    for your own edits, emails for collaborators. One-line change in the `AuthGate` bridge (no schema/wire
    change - `author` stays a free string). (c) **Rename propagates live** - the authority calls
    `setProjectName` when it applies a `renameProject` edit (so `projects.name` is authoritative without the
    renamer pushing `meta.json`), and a peer patches its library-list label straight from the edit via a new
    `SharedSession.onRemoteEdit` hook -> `patchProjectName`. (d) **Account avatar + panel** - a rail avatar
    (your colour + initials) above the settings gear opens an account panel (name, email, sign out; the
    single home for sign-out now). Still deferred: the fuller server-side `meta.json` retirement (keep it
    only as the OPFS/offline fallback index).
    Do auth **before** Phase B/C - it changes the ownership/principal model both build on.
    Then: **Phase B** (server-side history/keyframe/commits), **Phase C** (presence), **Phase D**
    (solo-offline PWA).
  - **Transport: WebSocket for the live edit channel, HTTP for the rest.** The WS *contract* already
    ships (slice 64: `ws.ts` message unions, typed `createWsClient`); this slice stands up the socket
    server (`@hono/node-ws` or `ws`) + dispatcher, reusing the append core. List/delete, blob/sample
    transfer, and bundle export stay HTTP. Transport edits as semantic `EditCommand`s, never document
    snapshots - the command is the one unit for local apply, WS broadcast, persisted delta, and commit.
  - **Server becomes the authority (the "dumb blob store -> smart authority" shift).** Per project, one
    authority instance holds the in-memory replay state, assigns the authoritative `seq`, applies, and
    broadcasts `editApplied` to peers. History/keyframe/commit logic moves **server-side** (the server
    now owns the replay engine, so the deferred server-side-keyframe and commit-referencing items land
    here). Client traffic collapses to *semantic commands out, broadcasts in* (+ presence) - no more
    whole-`project.json` uploads or client-computed keyframes. This is the deliberate departure from the
    thin `(projectId, path) -> bytes` store; the `BundleStore` seam already permits a smart backend.
  - **Conflict resolution: server-authoritative total order + optimistic apply + rebase** (NOT OT, NOT
    CRDT). The client applies a command optimistically to its local replica and sends it tagged with the
    last authoritative `seq` it saw + a client op-id; the server appends it at the next `seq`, applies to
    HEAD, and broadcasts; a client that had in-flight ops **rebases** (roll back optimistic ops, apply
    the authoritative ones in order, re-apply its pending ops on top). Rationale: our edits are coarse
    **semantic** commands that mostly target *different* objects, so they commute and the authority need
    only *order* them; the rare **same-target** clash (two users on one knob/note) resolves
    **last-writer-wins by `seq`**, which matches expectation. OT is rejected (a ~50x50 transform matrix);
    CRDT is rejected *for now* because its value is authority-free multi-primary merge, which we do not
    need (single authority per project, single region at a time) and which would reshape `ProjectStore`
    and lose semantic intent. CRDT stays the escape hatch only if offline-collaboration or
    multi-region-per-project ever becomes a hard requirement. Two requirements this imposes: (1)
    **`applyEdit` must no-op gracefully on a stale target** (e.g. `addNote` to a track another user just
    deleted) instead of throwing; (2) **client op-ids** so reconnect/retry never double-applies. This is
    when `editCommandSchema` graduates from structural to first-class typed and server-assigned `seq`
    replaces the client-stamped `seq`.
  - **Ephemeral vs durable split.** Presence (cursors, who's online) and live MIDI are **never
    persisted** - they live in the room instance's memory / a pub-sub bus. Only authored `EditCommand`s
    hit Postgres, so write load stays proportional to real edits.
  - **Offline stance: solo-offline kept, live-collab requires a connection.** Solo editing stays
    **local-first** (OPFS working copy, queue commands, flush on reconnect - one writer, so the server
    sequences the queue with nothing to conflict against). Live collaboration requires a connection;
    brief disconnects are absorbed by the optimistic queue (reconnect -> replay pending -> rebase). We do
    **not** go Onshape-online-only (solo offline is cheap and valuable) nor full offline-first (that
    effectively demands CRDT). **Offline *during* active collaboration is deferred** - the genuinely hard
    merge; when wanted, prefer **branch-and-merge** (an offline session becomes a branch, reconnect does a
    3-way semantic merge via the commit DAG we already have) over CRDT, decided then.
  - See the hosting/scaling entry above: the authority is **per-project** (the shard unit), so a project
    is single-region at a time; server-assigned `seq` is the enabling change.
- **Hosting & scaling.**
  - **First deploy - DONE (slice 81):** the recommended shape below is now realized as a concrete,
    repeatable deploy (runbook in `docs/DEPLOY.md`). **Single origin:** one Node process serves the built
    client (`dist/`), the Hono API, and `/ws` from one URL (the server gained static + SPA-fallback
    serving in `server/api/index.ts`; the auth gate is scoped to `/projects` so static assets aren't
    401'd). **Fly.io** runs it as a **scale-to-zero** machine (`fly.toml`: one `shared-cpu-1x`/256 MB,
    `max_machines_running = 1`, no volume - bounds cost to ~$2-3/mo worst case, near-$0 idle) + **Neon**
    free Postgres; migrations apply on boot. Scale-to-zero is safe here because a room rebuilds by
    replaying the `edits` table and clients reconnect/gap-fill (slice 76) - the only cost is a few-second
    cold start after idle; flip `min_machines_running = 1` for a live session. Deployed with **auth on**
    (the Supabase JWT stack, slices 77-80). The scaling model below (per-project sharding, single-region)
    still stands as the growth path; nothing here forecloses it.
  - **The constraint:** the realtime server holds **WebSocket** connections - long-lived, stateful -
    unlike today's stateless HTTP API. That rules out request/response **serverless** (Vercel/Netlify
    functions, plain Lambda) for the socket layer; it needs an always-on process.
  - **Affordable platforms to start:** a small always-on **Node** instance + **managed Postgres**.
    Recommended default **Fly.io** (runs the process as a long-lived VM, holds WS, region-pinnable next
    to the DB, a few $/mo) **+ Neon** (serverless PG, scale-to-zero, branching, built-in pooler) - or
    **Railway** for both if one dashboard is preferred. **Supabase** is tempting because it could also
    supply auth (replacing the stubbed token). **Cloudflare Durable Objects / PartyKit** is the
    odd-one-out: purpose-built stateful per-key "rooms" (each project = one addressable actor), the
    cleanest fit for the model below, but a Cloudflare tie and a non-Node (Workers) runtime, so reach
    for it only if per-project rooms dominate. Avoid API-Gateway-WebSockets-on-Lambda (awkward).
  - **The project is the shard unit at every layer.** A project's edit stream is a single ordered log,
    so multiplayer needs exactly **one authority per project** (assigns order/`seq`, applies, broadcasts).
    That same `projectId` partitions all three layers: (1) **WS routing** - a stateless gateway routes a
    client for project P to P's owning instance (consistent hashing on `projectId`, or a directory;
    Durable Objects/PartyKit do this natively via `idFromName(projectId)`); (2) **in-memory authority** -
    the owner holds P's replay/CRDT state and fans out to P's peers, with **failover** cheap because any
    instance can reload P from Postgres (keyframe + replay - the path already built) and take ownership;
    (3) **DB sharding** - only when a single vertically-scaled PG (with pooling, read replicas, and
    `edits` partitioned by `projectId`) is outgrown, shard by `projectId`/`ownerId`; a project never
    spans a shard. This is clean **only because** the schema is already owner-/project-scoped with no
    cross-project joins ("multi-user later is a change of principal, not of queries"). Ephemeral state
    (presence, cursors, live MIDI) stays in the room's memory / a pub-sub bus, never the DB - so PG write
    load stays proportional to authored edits. The one code change scaling assumes: the **server** assigns
    `seq` (not the client, as today), the multiplayer/authoritative-log change.
  - **A project is single-region at a time (consequence, acceptable).** One authority per project means
    that authority - and ideally its DB shard - lives in **one region** at any instant. The *service* is
    multi-region (different projects homed in different regions; a project's ownership can **migrate**
    regions on failover/rebalance, e.g. toward its active collaborators), but a single project is **not**
    simultaneously authoritative in two regions - that would break the single total order. This is not a
    latency problem in practice: with **optimistic local apply** (apply instantly, reconcile on server
    ack), the authority's region only affects when the authoritative order/conflict-resolution *confirms*,
    not the felt responsiveness of editing. The only way to make one project genuinely multi-region
    (multi-primary, no central order) is a **CRDT** (yjs/automerge), which drops the single-`seq`
    authority for conflict-free merge - a real fork we are deliberately *not* taking now (we lean
    single-authority + server-assigned `seq`). So: single region per project unless/until a CRDT model is
    adopted; revisit only if globally-distributed collaborators on one project become a real need.

**Security hardening (from a review of the sync service):**

- **The three code-level gaps - _closed_ (slice 65):**
  1. **Validation is no longer bypassable via `Content-Type`.** The PUT now decides JSON-vs-binary by
     **path** (`isBinaryPath` in the contract: `samples/*` = binary, everything else = JSON-to-validate)
     rather than the client-supplied header, so a JSON path can never be smuggled in as opaque `bytea`
     to skip `validateBundleFile`.
  2. **Request body size is capped** - `hono/body-limit` on the PUT route with per-path limits (a
     larger cap for `samples/*` than for JSON docs, both overridable via `AppOptions`), so an oversized
     upload is refused with 413 before the body is buffered whole.
  3. **Write-once history is race-safe** - the commit guard is now an atomic
     `insert(...).onConflictDoNothing().returning()`: the `(projectId, path)` unique constraint lets
     exactly one concurrent insert win, and the loser (no row returned) is a 409 - no check-then-upsert
     for two writers to race.
- **Harden for hosting - mostly DONE (auth epic, slices 77-80 + deploy slice 81).** The old shared
  token (open-by-default, single secret, timing-unsafe compare, hardcoded `"local"` owner) is **retired**;
  real per-user accounts + Supabase-JWT verification + owner-or-member authorization now gate every
  request and socket. Single-origin deploy makes the `*` **CORS** concern moot (no cross-origin browser
  calls). **Still open:** **per-owner quotas** (projects / files / bytes) against storage abuse, and
  rate-limiting on the auth/JWT path.
- **Client-side (inherent to shallow validation):** the loader must treat loaded project data as
  untrusted (defensive coercion on load; no unsafe deep-merge of loaded keys - a stored `__proto__`
  key is a prototype-pollution vector only if the client merges it carelessly).

## Licensing & business model (open source, trademark, contributions)

Direction as the project goes from disposable local tool to a hosted product with an ideal of being
the **sole provider**. Current state: **AGPL-3.0-or-later** (`package.json` + a full `LICENSE`), a
**DCO** in `CONTRIBUTING.md`, SPDX headers crediting **Alden Laslett** (sole copyright), repo public
(`alden12/web-daw`). Not legal advice - decisions to revisit at launch.

**The keystone insight: three different tools solve three different problems - don't conflate them.**

- **The licence (AGPL vs BSL)** governs what *users* may do. This is where any "traction cost" lives.
- **A trademark** governs who may use the *name/brand*. Compatible with open source (Firefox/WordPress
  model). This is the real "sole provider" lever.
- **A CLA/DCO** governs what *contributors* grant *you*. Invisible to users; costs nothing in adoption.
  This is what preserves (or fails to preserve) your ability to relicense later.

A single scenario maps to each cell, and the common mistake is expecting one tool to cover another's
job:

| Threat | AGPL | Trademark | Source-available (BSL/SSPL) |
| --- | --- | --- | --- |
| Competitor forks, improves privately, out-hosts you | **blocks** (must publish changes) | - | blocks |
| Someone hosts your code & charges, under *their* name | allows | - | **blocks** |
| Someone hosts it and calls it *your* product | - | **blocks** | - |

The "host my code and charge as their own" cell is the one **AGPL + trademark leaves open**. Only a
source-available licence closes it, and that means giving up the OSI "open source" label (the OSI
definition forbids field-of-use restrictions, so no OSI licence can bar hosting).

**Why AGPL now (not BSL).** AGPL is *more* valuable once hosted: it closes the SaaS loophole (anyone
running a modified version as a service must publish their changes), which deters the *dangerous*
competitor - a funded, closed, differentiated fork. The naive "rehost verbatim and charge" copycat is
not a real threat pre-traction: they run a stale snapshot with no roadmap, support, brand, or your
users (accounts/multiplayer/sync are the actual moat), always behind your HEAD. Strip-mining targets
proven-demand infrastructure (DBs/search), not a pre-revenue creator app.

**Timing is inverted - the reason not to "BSL during development."** The intuition "protect while
building, open up at launch" is backwards on both axes: rehosting **risk is ~zero pre-launch and
grows with traction**, while BSL's **cost (contributor friction, non-OSS label, credibility) is
highest during the growth phase**. BSL-during-dev buys protection you don't need and pays for it when
it hurts most. The industry playbook is the reverse: start open, and *if* you become a genuine
strip-mining target, apply BSL to **new versions then** (Sentry/CockroachDB/HashiCorp). That works
despite old versions staying open, because stale forks don't compete - so "AGPL is forever" is much
softer in practice than it sounds. Reversibility asymmetry still favours caution (you own 100% of the
copyright, so stricter->looser is trivial; looser->stricter needs the CLA below), but it is not a
reason to pre-emptively restrict.

**BSL, if ever adopted**, is the MariaDB BSL 1.1 template with an *Additional Use Grant* carving out
"no competing hosted service" (self-hosting/non-prod/forking still allowed) and a *Change Date*
converting each version to AGPL after ~4 years. `package.json` would use the SPDX id `BUSL-1.1` (or
`"SEE LICENSE IN LICENSE"`), with the Additional Use Grant + Change Date living in the `LICENSE` file -
the SPDX id alone does not encode those parameters.

**Contributions: DCO preserves provenance, NOT relicensing.** The DCO certifies a contributor had the
right to submit under AGPL (inbound = outbound); it gives *you* no right to relicense their code. So
DCO does **not** keep the BSL door open. What does is a real **CLA** (copyright assignment or a broad
grant including the right to relicense). **But while sole author you already have full relicensing
freedom** - you own everything - so no CLA is needed yet; DCO is correct low-friction hygiene. The
**trigger** to decide is the *first non-trivial outside contribution*, at which point that slice becomes
AGPL-locked unless you first: (a) add a lightweight "CLA-lite" clause to `CONTRIBUTING.md` (inbound
under AGPL **plus** a grant to relicense under future project licences - middle path, low friction), or
(b) adopt a full CLA + signing bot (max optionality, max friction), or (c) accept AGPL-lock and move on.
Keep the SPDX copyright as the sole holder (not "contributors") to keep this clean.

**Trademark: territorial, defer to traction.** A trademark is national/regional - a UK mark protects
only the UK; there is no world trademark. You don't register everywhere up front, and waiting is safe
because of two treaties: **Paris Convention priority** (file UK, then within 6 months foreign filings
can back-date to the UK date) and the **Madrid Protocol** (one WIPO application off the UK "home" mark,
add countries later). Meanwhile there is free/cheap cover: UK "passing off", US **first-to-use** common-
law rights, and grabbing the domain + handles at naming time (the real early squatting vector). UK IPO:
~£170 first class + £50/extra, classes 9 (software) + 42 (SaaS) (+ maybe 41), ~3-4 months if unopposed.
EU is efficient (one EUTM covers all 27, ~€850+); US via USPTO (~$250-350/class). **Sequencing:** cheap
brand hygiene now (distinctive, invented/arbitrary name - descriptive marks like "web-daw" are largely
unregistrable/unenforceable; grab domain+handles) -> file UK at public launch under the brand -> within
6 months add EU/US *if traction warrants* -> Madrid for further countries reactively.

**Decisions / triggers (deferred, not blocking):**

- **Licence:** stay AGPL through development and launch. Revisit BSL only on real traction + genuine
  rehosting-target status, applied to new versions.
- **CLA:** none needed while solo. Decide at the first non-trivial outside PR (CLA-lite vs full CLA vs
  accept AGPL-lock). Preserve sole-copyright SPDX headers until then.
- **Trademark:** no action until public launch under the brand. Actionable now only: pick a distinctive
  name and grab domain + handles at naming time.
- Related memory: `web-daw-licensing`.
