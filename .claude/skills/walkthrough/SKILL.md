---
name: walkthrough
description: Run an interactive, section-by-section code walkthrough of a feature in VS Code - jump the editor to each section, explain it, pause for questions, then move on. Also authors the tour markdown doc from a feature/topic. Use when the user wants a guided tour of unfamiliar code (e.g. "walk me through the backend auth", "give me a tour of X"), or invokes /walkthrough.
---

# Code walkthrough

An interactive, presenter-style tour of a feature's code. A tour is a markdown
"script" (under `docs/tours/`) with ordered sections; a session plays it one
section per turn, jumping the VS Code editor to each spot, explaining it, and
pausing for the user's questions before continuing.

There are two things this skill does: **author** a tour doc, and **run** a tour.

## Parsing the invocation

The user invokes as `/walkthrough <args>`. Interpret `<args>`:

- **Empty** -> list the tours in `docs/tours/` (ignore `_template.md` / `README.md`)
  and ask which to run, or offer to author a new one.
- **Starts with `create` / `author` / `new`** (e.g. `create backend auth`) -> author
  mode. The rest is the feature/topic.
- **A path to an existing tour** (e.g. `docs/tours/backend-auth.md`) -> run mode.
- **A bare topic** that matches an existing tour file -> run that tour; otherwise
  offer to author it.
- A trailing **`a`** or **`b`** token selects the drive mode for a run
  (e.g. `docs/tours/backend-auth.md a`). Default is **b**. See "Drive modes".

## Drive modes

- **Mode b (default): auto-jump.** For each section run
  `code -g <file>:<startLine>` via Bash so the user's editor scrolls to and places
  the cursor at the section. Always ALSO print the clickable `file:line` reference
  (that is mode a, included for free) so they can re-jump by clicking.
- **Mode a: links only.** Skip the `code -g` call; just print the clickable
  `file:line` reference and let the user click to open.

**Diff-aware tours (walking through *recent changes*).** When the tour is of a diff
(working-tree changes, or a branch vs its base) rather than settled code, the red/green
diff view adds real value - it shows what each section *changed*, not just what it is. In
that case open the section's file in VS Code's diff editor instead of the plain file:
materialize the "before" version to a temp file and `code --diff <before> <file>`
(`git show <baseref>:<file> > tmp` first). Baseref is `HEAD` for uncommitted working-tree
changes, or the base branch (e.g. `main`, the parent slice) for committed branch work. The
`--diff` editor can't target a line, so keep printing the clickable `file:line` and the
inline snippet for precise section context. To keep this cheap per turn, write a tiny
reusable shell helper **once** (takes `<file> [baseref] [line]`, does the materialize +
`code --diff`, falls back to `code -g` when there is no diff) and call it per section - do
not re-derive the temp-path/baseref plumbing each turn.

Before the first `code -g` in a session, confirm the CLI exists with
`command -v code`. If it is missing, tell the user (once) that auto-jump needs the
`code` CLI ("Shell Command: Install 'code' command in PATH" from the VS Code
command palette), fall back to mode a for the session, and continue.

Note on highlighting: `code -g` scrolls + positions the cursor but cannot select a
multi-line range. The "highlight" is the inline snippet you print in chat. True
in-editor range selection would need a small companion VS Code extension - only
pursue that if the user asks.

## Running a tour

Read the tour doc, then play it **one section per turn**. This pacing is the whole
point - never dump multiple sections or the entire tour in one message.

For each section:

1. If mode b, `code -g <file>:<startLine>` to move the editor. Re-read the current
   line numbers if the file looks like it has drifted from the doc (see "Drift").
2. Print a compact header: `Section N/total - <title>` and the clickable
   `<file>:<startLine>` reference.
3. When the section is dense or turns on a non-obvious design decision, open with a
   one-line **TL;DR** (a `>` blockquote) that states the takeaway - the "so what" -
   so the reader can decide whether to dig in or just say `next`. Skip it when the
   title already says everything; a redundant TL;DR is noise.
4. Show the focused lines as a fenced snippet (read them fresh from the file so
   they are accurate). Keep it to the lines that matter, not the whole file.
5. Explain **briefly**: lead with the single most important point and make it
   intuitive and clear, then stop. Prioritise the key info first; prefer plain
   language over restating the code. Resist the urge to preempt every question - the
   reader can always ask a follow-up, and depth-on-demand reads better than a wall
   of text. A few tight sentences usually beats a paragraph.
6. Stop and invite questions. Remind them of the controls the first time:
   `next` (continue), `back`, `jump to N`, `re-explain`, `exit`.

Then WAIT. Answer whatever they ask against the real code (open related files if a
question leads elsewhere - that is encouraged), and only advance when they signal
to. State `Section N/total` each turn so progress is unambiguous across the
conversation.

At the end, give a one-paragraph recap of how the sections fit together and offer
to revisit any of them.

### Drift

Tour docs anchor to `file` + `lines` + an optional `symbol`. Line numbers drift as
code changes. Treat `symbol` as the source of truth: if the lines no longer match
the symbol, locate the symbol, use its current lines, and mention nothing unless
the drift is large - in which case suggest re-authoring the tour.

## Authoring a tour

Goal: a doc that reads as one coherent story, ordered by **concept**, not by the
PRs the code landed in.

1. Explore the feature's code across all relevant files (use the Explore agent for
   breadth). Build the narrative order: entry point -> core mechanism -> edges
   (storage, middleware, error paths).
2. Write `docs/tours/<slug>.md` following `docs/tours/_template.md`. For each
   section fill `file`, `lines`, and `symbol` (a function/class/const name) so the
   tour survives line drift. Keep explanations in the doc short - they are the
   presenter's notes, expanded live during the run.
3. The doc is also standalone onboarding documentation, so make it readable on its
   own.
4. When done, tell the user how to run it: `/walkthrough docs/tours/<slug>.md`.

Keep the doc grounded: every section must point at real code you have read.
