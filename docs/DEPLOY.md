# Deploying web-daw

web-daw deploys as **one always-available Node service** that serves the built client, the Hono API, and
the `/ws` realtime socket from a **single origin**. There is no separate frontend host: the same server
serves `dist/`. Backing store is a **managed Postgres** (Neon); identity is **Supabase** (JWT issuer only
- our server verifies the token, Supabase holds no project data).

Target for the dev window: **Fly.io** (scale-to-zero) + **Neon** (free tier) + the existing **Supabase**
project. Effectively free (a few cents to ~$2-3/mo worst case), with a few-second cold start after idle.

## How it fits together

```
                    https://web-daw.fly.dev   (one origin)
  browser  ─────►   /            -> dist/index.html   (SPA)
                    /assets/*    -> built JS/CSS
                    /projects/*  -> Hono API (JWT-gated)
                    /ws          -> WebSocket authority
                         │
                         ├─ verifies JWT against Supabase JWKS  (SUPABASE_JWKS_URL / _ISSUER)
                         └─ reads/writes Neon Postgres          (DATABASE_URL)
```

- **Build-time config** (baked into the client by Vite, so it must be set when the image is built):
  `VITE_DAW_API_URL` (the deploy origin), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public/safe).
- **Runtime config** (server env / Fly secrets): `DATABASE_URL`, `SUPABASE_JWKS_URL`,
  `SUPABASE_JWT_ISSUER`. `API_PORT` and `NODE_ENV` are set in `fly.toml`.
- Migrations run automatically on boot (`applyMigrations` in `server/api/index.ts`), so a fresh database
  is provisioned on the first deploy - no manual migrate step.

## First-time setup

Prerequisites: a Fly.io account + `flyctl` installed and logged in (`fly auth login`), a Neon account, and
the existing Supabase project.

1. **Neon**: create a free project. Copy its connection string and append `?sslmode=require`, e.g.
   `postgres://user:pass@ep-xxx.eu-west-2.aws.neon.tech/neondb?sslmode=require`.

2. **Create the Fly app** (does not deploy yet):
   ```sh
   fly launch --no-deploy
   ```
   Reuse the committed `fly.toml`. App names are globally unique, so Fly may append a suffix - note the
   resulting subdomain (e.g. `web-daw.fly.dev` or `web-daw-1234.fly.dev`); it is your origin below.

3. **Set runtime secrets**:
   ```sh
   fly secrets set \
     DATABASE_URL='postgres://...neon.tech/neondb?sslmode=require' \
     SUPABASE_JWKS_URL='https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json' \
     SUPABASE_JWT_ISSUER='https://<project-ref>.supabase.co/auth/v1'
   ```

4. **Set a billing alert** in the Fly dashboard (Billing -> set a $5 alert). Fly has no hard spend cutoff;
   the resource caps in `fly.toml` (one `shared-cpu-1x`/256 MB machine, `max_machines_running = 1`, no
   volume) bound the bill to ~$2-3/mo worst case, and this alert catches anything unexpected.

5. **Deploy** (passing the build-time client vars; use your actual origin from step 2):
   ```sh
   fly deploy \
     --build-arg VITE_DAW_API_URL='https://web-daw.fly.dev' \
     --build-arg VITE_SUPABASE_URL='https://<project-ref>.supabase.co' \
     --build-arg VITE_SUPABASE_ANON_KEY='<anon-public-key>'
   ```

6. **Point Supabase at the deploy origin**: Supabase dashboard -> Authentication -> URL Configuration ->
   set **Site URL** to `https://web-daw.fly.dev` and add it to **Redirect URLs**. The GitHub/Google OAuth
   apps stay pointed at Supabase's callback (`https://<project-ref>.supabase.co/auth/v1/callback`) - they
   do not change; only Supabase's allowlist of app origins does.

7. **Verify**: open `https://web-daw.fly.dev` (expect a few-second cold start on the first hit), sign in
   with Google/GitHub, make an edit, reload - it persists. Share a project with a second account and
   confirm live multiplayer edits, distinct per-account colours, and live rename propagation.

## Redeploying

After the first setup, a redeploy is just step 5 again (secrets and Supabase config persist):

```sh
fly deploy \
  --build-arg VITE_DAW_API_URL='https://web-daw.fly.dev' \
  --build-arg VITE_SUPABASE_URL='https://<project-ref>.supabase.co' \
  --build-arg VITE_SUPABASE_ANON_KEY='<anon-public-key>'
```

## Cost lever: scale-to-zero vs always-on

`fly.toml` ships **scale-to-zero** (`min_machines_running = 0`, `auto_stop_machines = "stop"`): near-$0
while idle, a few-second cold start for the first visitor after idle. No data is lost across a
stop/start - the authority rebuilds each room by replaying the edits table, and clients reconnect and
gap-fill.

For a scheduled live co-editing session where a guest shouldn't wait on a cold start, flip to always-on:

```sh
fly scale count 1               # keep one machine running
# or edit fly.toml: min_machines_running = 1, auto_stop_machines = "off", then `fly deploy`
```

Always-on is ~$2-3/mo for the single small machine; revert to scale-to-zero afterwards.

## Custom domain (later)

No product name is needed during dev - the `*.fly.dev` subdomain is the origin. To move to a custom
domain later: `fly certs add app.example.com`, point DNS at Fly, add the new origin to Supabase's Site URL
+ Redirect URLs, and redeploy with `VITE_DAW_API_URL=https://app.example.com`. No source change.

## Local production check (before touching the cloud)

Prove the single-origin server locally first:

```sh
yarn build                                   # produces dist/
yarn db:up                                   # local Postgres
DATABASE_URL=postgres://webdaw:webdaw@localhost:5432/webdaw API_PORT=8080 NODE_ENV=production yarn start
# browse http://localhost:8080 - client loads from the server (not Vite), edits persist across reload
```

Then prove the image:

```sh
docker build -t web-daw --build-arg VITE_DAW_API_URL=http://localhost:8080 .
docker run --rm -e DATABASE_URL='postgres://host.docker.internal:5432/webdaw' -p 8080:8080 web-daw
```

## Notes

- **MCP is unaffected by deployment.** The MCP server is a local companion on the user's machine; the
  browser connects out to it over `ws://localhost`, which browsers permit from an `https://` page. A
  remote/hosted MCP (through the sync authority) is on the roadmap, not needed here.
- **Anti-lock-in.** Nothing couples to Neon or Fly specifically. Moving Postgres elsewhere is `pg_dump` +
  a new `DATABASE_URL`; moving hosts reuses the same Dockerfile.
