# web-daw - conventions

Architecture and project direction live in `docs/DESIGN.md`. This file is the
short list of coding conventions to follow throughout the codebase.

## Validation

- Use **zod** for validation at every untrusted boundary (MCP tool inputs,
  parsing/loading external data). Derive zod schemas from the parameter schema
  rather than hand-writing checks - see `specToZod` in `src/audio/params/zod.ts`.
- Keep "validation" (reject bad input, with a message) distinct from
  "coercion/normalization" (clamp/snap a trusted value). The `ParamStore` coerces;
  the MCP boundary validates.

## Style: functional and declarative

- Favour functional, declarative code over imperative. Prefer `map`/`filter`/
  `reduce`/`flatMap` and immutable transforms over manual loops and mutation. Reach
  for a `for` loop only where it genuinely reads better or matters for performance -
  the realtime hot paths (the scheduler `tick`, the worklet `process()` sample loops)
  are the legitimate exceptions, not the rule.
- **Use full, descriptive variable names, including in iterators and short lambdas**
  (`tracks.map((track) => ...)`, not `(t) =>`; `clip`, `placement`, `effect`, `note`,
  not `c`/`p`/`fx`/`n`). Existing single-letter code is grandfathered; write new code
  the readable way and tidy names as you touch the surrounding lines.
- For key-based dispatch, use an **object key -> value (or key -> function) map**
  instead of `switch`/`case` or long `if`/`else if` chains. Examples in the code:
  the MCP bridge inbound handlers (`src/audio/mcp/bridge.ts`), the param coercers
  (`src/audio/params/store.ts`), and the schema-to-zod builders
  (`src/audio/params/zod.ts`). This keeps the set of cases data, so it is easy to
  extend and hard to leave a case unhandled.

## Extensibility: don't hardcode the catalog

- Instruments, effects, and their parameters are declared once in the pure
  catalogs (`src/audio/instruments/catalog.ts`, `src/audio/effects/catalog.ts`)
  and realized by the registries (`registry.ts`). These are the single extension
  points. Adding one should be: add a schema + catalog entry, add a factory.
- The registries are typed `Record<InstrumentType, ...>` / `Record<EffectType, ...>`
  off the catalog keys, so a cataloged type without a factory is a compile error.
- UI and MCP must **iterate the catalogs**, never hardcode instrument/effect/param
  names or lists. New entries should appear in the library, the add menus, and the
  MCP palette automatically.

## Files & formatting

- **Split files before they get unwieldy.** When a file grows past a few hundred
  lines or starts holding several unrelated responsibilities, break it up (extract a
  component, a helper module, a sub-store). Prefer many small, focused files over one
  large one. Current oversized files to chip away at when touched: `projectStore.ts`,
  `AudioEngine.ts`, `ArrangementTimeline.tsx`.
- **Leave every file formatted after editing.** Match the surrounding style exactly so
  edits don't churn when the editor reformats on save. (A repo-wide Prettier config +
  `yarn format` + a CI format check is the durable fix - a worthwhile follow-up, but
  it reformats the whole tree once, so it lands as its own PR.)

## Persistence: no legacy/format-migration support

- We are the only users, so **don't carry legacy formats.** Bump the snapshot/storage
  version freely and don't write migration paths, `LEGACY_*` keys, or `Legacy*`/
  back-compat fields for old data. When a format changes, the old saved project is
  simply discarded. (Existing migration code - `VariantData`, `LegacyAudioClip`, the
  `ProjectStore.load` migration, `LEGACY_KEYS` - is fair game to delete.)

## CI

- `build`, `test`, `test:e2e`, and `tsc` (via `build` + `check:server`) run in GitHub
  Actions (`.github/workflows/ci.yml`) on every push to `main` and every PR. Keep them
  green; a red gate blocks the merge.

## General

- The parameter schema is the keystone: UI, MCP, automation, and persistence are
  projections of it. Don't add per-parameter or per-type UI/branching - map over
  the schema/catalog.
- Keep the Node MCP server DOM-free: pure data (schemas/catalogs) stays in
  `catalog.ts`; anything touching Web Audio stays in `registry.ts`/engine.
- No em-dash characters in committed text (commits, comments, docs).
