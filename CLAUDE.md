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
  `reduce`/`flatMap` and immutable transforms over manual loops and mutation where
  it reads as clearly.
- **Real-time carve-out:** the scheduler tick and per-sample DSP loops stay
  imperative (`for`/`while`, in-place mutation) - allocation and iterator overhead
  matter on the audio path. Apply the functional preference everywhere else.
- For key-based dispatch, use an **object key -> value (or key -> function) map**
  instead of `switch`/`case` or long `if`/`else if` chains. Examples in the code:
  the MCP bridge inbound handlers (`src/audio/mcp/bridge.ts`), the param coercers
  (`src/audio/params/store.ts`), and the schema-to-zod builders
  (`src/audio/params/zod.ts`). This keeps the set of cases data, so it is easy to
  extend and hard to leave a case unhandled.

## Style: descriptive names

- Prefer full, descriptive variable names over single-letter or condensed ones,
  **including in iterator/collection callbacks** - `tracks.map((track) => ...)`,
  not `(t)`. Names should read as domain terms (`clip`, `placement`, `note`,
  `effect`), not initials.
- Carve-outs where short names stay idiomatic: React event params (`e`), numeric
  loop indices (`i`), and sort comparators (`(a, b)`). The real-time scheduler
  tick and per-sample DSP loops are also left alone (see the functional carve-out
  above).

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

## General

- The parameter schema is the keystone: UI, MCP, automation, and persistence are
  projections of it. Don't add per-parameter or per-type UI/branching - map over
  the schema/catalog.
- Keep the Node MCP server DOM-free: pure data (schemas/catalogs) stays in
  `catalog.ts`; anything touching Web Audio stays in `registry.ts`/engine.
- No em-dash characters in committed text (commits, comments, docs).
