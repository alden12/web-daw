# Handover (point-in-time: 2026-07-14)

A snapshot to pick the project back up on a fresh machine / new session, capturing the things that live
*outside* the code (deployment accounts, environment gotchas, current state, open threads). The design and
architecture are in the other docs (below); this file is the operational and status layer that would
otherwise only exist in a session's memory.

## What web-daw is

An open-source, web-based DAW. One declarative **parameter schema** is the keystone that UI, MCP, automation
and persistence all project from. DSP is written once (shared between an offline `.wav` test renderer and the
shipped AudioWorklet). An **MCP server** and an in-app agent are two clients of the same tool/edit surface.
Now a hosted, multi-user web app with real sign-in.

## Where the canonical docs are (source of truth, all in git)

- `docs/BRIEF.md` - original project brief + v1 scope.
- `docs/DESIGN.md` - the big one: architecture, UI direction, persistence + semantic VCS, multiplayer,
  hosting/scaling, migrations, licensing/business model, and the full roadmap. Read this first.
- `docs/AGENT.md` - the agent architecture (one action space / three clients; ReAct now, actor model +
  "ears" audio-analysis later; provider/BYOK).
- `docs/DEPLOY.md` - the deploy + operations runbook (Fly + Neon, secrets, invite-only auth, migrations).
- `CLAUDE.md` - coding conventions and repo rules (zod at boundaries, map-dispatch over switch, iterate the
  catalogs, DOM-free MCP server, forward-only migrations, no em-dash, running e2e locally, etc.).

## Current state (2026-07-14)

- **The app is deployed and live: https://web-daw.fly.dev** - Google sign-in + project persistence verified
  end to end.
- **Open PR stack, not yet merged to `main`** (each stacked on the previous): #82-#85 (auth groundwork),
  #86 Auth-A (server principal), #87 Auth-B (browser login), #88 Auth-C (sharing by email), #89 auth cleanup
  (email identity, retire DAW_API_TOKEN, live rename, account panel), **#90 deploy** (this slice). Current
  branch: `slice-81-deploy`. Merging the stack into `main` is a pending step.
- The auth epic (Supabase JWT verification, per-user data, sharing-by-email) and the deploy slice are the
  most recent work; both are described in `docs/DESIGN.md` and `docs/DEPLOY.md`.

## Live deployment - accounts and config (the bits not in code)

- **Fly.io:** app `web-daw`, org `personal`, account `ablaslett@gmail.com`, region `lhr`. One
  `shared-cpu-1x`/256 MB machine, **scale-to-zero** (cold start ~8s, warm ~0.2s), capped at 1 machine, no
  volume (~$2-3/mo ceiling, near-$0 idle). Config in `fly.toml`; ops via `yarn deploy` / `yarn fly:logs` /
  `yarn fly:status` / `yarn fly:restart`.
- **Neon:** the production Postgres. Use the **direct** connection string (not the pooler) with
  `?sslmode=require` and **without** `channel_binding=require` (breaks `postgres.js`). The `DATABASE_URL`
  lives in Fly secrets, not the repo.
- **Supabase** (identity provider only - issues JWTs, holds no project data): project ref
  `jthcrhyuktstilsafcfa`. Requires **asymmetric** JWT signing keys (JWKS verification). The public
  `VITE_SUPABASE_*` client values are in `fly.toml [build.args]`; `SUPABASE_JWKS_URL`/`SUPABASE_JWT_ISSUER`
  are Fly secrets.
- **Auth is invite-only:** Google only (GitHub button hidden via `GITHUB_ENABLED = false` in
  `src/ui/AuthGate.tsx` + the GitHub provider disabled in Supabase). Google's OAuth consent screen is in
  **Testing** mode, so its Test-users list *is* the whitelist. To open up: flip `GITHUB_ENABLED` + re-enable
  the Supabase provider (GitHub), or move Google to Published.

## Environment gotchas (would cost you an hour each to rediscover)

- **flyctl DNS flake on this network:** `flyctl` intermittently fails `lookup api.fly.io / api.machines.dev:
  no such host`. `scripts/deploy.sh` works around it (sets `GODEBUG=netdns=cgo` + flush/prime DNS + retry).
  Durable fix: set the OS resolver to `1.1.1.1` / `8.8.8.8`.
- **Running `test:e2e` locally needs `.env` moved aside** (see CLAUDE.md) - a local Supabase `.env` gates the
  app behind login and every Playwright test times out.
- **Vitest is node-env, no jsdom** - there are no React component tests; UI is verified via e2e (Playwright)
  or live. Don't fake component-test coverage.
- **In-app agent (dev):** provider is BYOK; on Gemini use `gemini-2.5-flash` (`gemini-2.0-flash` reported
  zero free-tier quota), and free tiers rate-limit multi-step loops (429).
- **Local dev loop is unchanged by the deploy:** `yarn db:up` + `yarn dev` (Vite :5155) + `yarn api`
  (:5170). `yarn start` is the single-origin production entry (serves the pre-built `dist/`), not a dev loop.

## Open threads / near-term roadmap (full detail in DESIGN.md)

- **Merge the PR stack** (#82-#90) into `main`.
- **Auth follow-ups:** re-enable GitHub once stable; a server-side `ALLOWED_EMAILS` allowlist
  (defence-in-depth); **per-owner quotas** + auth **rate-limiting** (the remaining "harden for hosting"
  items).
- **Owed to the user:** a piece-by-piece walkthrough of the whole auth system (they asked for this once it
  was in place).
- **Multiplayer Phase B+:** server-side history / keyframes / commits (the authority already replays the
  edit log to rebuild state on load; server-written keyframes to bound replay are deferred), then presence
  (C) and solo-offline PWA (D). A remote/hosted MCP (through the sync authority) is on the roadmap; local MCP
  works now.
- **MIDI devices:** a global project key/scale on `ProjectData` + a `map` transform kind for scale-aware
  devices (diatonic harmonizer, quantizer, key-aware arp); arp follow-ons (pattern editor, latch, swing).
- **Agent:** give it "ears" (offline-render audio analysis: Tier-1 DSP via Meyda, then essentia.js MIR, then
  perceptual/`describe_sound`); notes-as-prompt modality; composite higher-level tools.
- **Persistence/VCS:** MCP `commit`/`list_history`/`diff` over the bridge; branches/cherry-pick (15C); real
  on-disk folder via File System Access API (15D) and eventually a Tauri shell; then the local-first
  file-watch story.
- **Licensing:** stays AGPL; the sole-provider lever is a **trademark** filed around public launch under a
  distinctive (non-descriptive) brand name; a CLA is only needed on the first non-trivial outside PR.

## Working-style preferences (from the user's global config)

- No em-dash (`-`) anywhere in committed text or chat - use a hyphen, comma, or parentheses.
- Open long chat responses with a short TL;DR, then the detail.
- British spelling throughout ("colour").
- Commit/push only when asked. Commit trailer `Co-Authored-By: Claude ...`; PR body trailer for Claude Code.

## Resuming on the new machine

1. Clone the repo - all of the above (docs, `CLAUDE.md`, `fly.toml`, scripts) comes with it. `CLAUDE.md`
   auto-loads.
2. Install tooling: `yarn`, Docker (for local Postgres), and `brew install flyctl` + `fly auth login` for
   deploys. Recreate `.env` from `.env.example` for local dev.
3. If you want the accumulated cross-session memory, copy it across (see below) - otherwise this file plus
   the docs are enough to carry on.
