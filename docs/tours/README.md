# Code tours

Interactive, section-by-section walkthroughs of features in this codebase. A tour
is a markdown "script" that a live session plays one section at a time - jumping
the VS Code editor to each spot, explaining it, and pausing for your questions
before moving on. Good for onboarding onto unfamiliar code.

Each tour doc also reads as standalone onboarding documentation on its own.

## Running a tour

In Claude Code:

```
/walkthrough docs/tours/<slug>.md          # auto-jump editor + clickable links (default)
/walkthrough docs/tours/<slug>.md a        # links only, no editor auto-jump
/walkthrough                               # list tours / offer to author one
```

- **Mode b (default):** the editor scrolls to each section automatically via the
  `code` CLI, and each section also prints a clickable `file:line` link.
- **Mode a:** links only - you click to jump.

During a run: `next`, `back`, `jump to N`, `re-explain`, `exit`. Ask questions
freely at any stop; the session answers against the real code.

### Auto-jump prerequisite

Mode b needs the `code` CLI on your PATH. If it is missing, run **"Shell Command:
Install 'code' command in PATH"** from the VS Code command palette. Without it, the
session falls back to links-only.

## Authoring a tour

```
/walkthrough create <feature or topic>
```

This explores the relevant code and writes `docs/tours/<slug>.md` from
`_template.md`, ordered by concept (not by the PRs the code landed in). Sections
anchor to a `symbol` name so they survive line-number drift.

## Notes

- `code -g` scrolls and places the cursor but cannot select a range; the
  highlighted snippet lives inline in the chat. True in-editor selection would need
  a small companion VS Code extension - not built yet.
