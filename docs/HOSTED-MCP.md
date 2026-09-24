# Hosted MCP server

Corrente's API serves an MCP server on `/mcp` (AGENT-28). It lets Claude edit your stored projects
from claude.ai or the Claude apps, with no local server running. Edits land live in any tab that has
the project open, authored as the agent for you, and undoable like any other edit.

Locally it runs on the dev stub, with no sign-in:

```sh
claude mcp add --transport http corrente-hosted http://localhost:5170/mcp
```

## Turning it on in production

The code is deployed with the API. The rest is Supabase configuration, done once in the dashboard of
the project Corrente signs in with.

1. **Enable the OAuth server.** Authentication → OAuth Server → enable it, and set the
   **authorization path** to `/oauth/consent`. That is the page in the app where you approve a
   connection. The Site URL must be the deployed origin (`https://web-daw.fly.dev`), because the
   authorization path hangs off it.
2. **Allow dynamic client registration.** In the same place, turn on *Allow Dynamic OAuth Apps*.
   Claude registers itself as a client when you connect. Claude Code refuses outright without this
   ("does not support dynamic client registration"), because it has nowhere to put a
   hand-configured client id.
3. **Add the audience hook.** Paste [supabase/mcp-audience-hook.sql](supabase/mcp-audience-hook.sql)
   into the SQL editor, then pick `corrente_access_token_hook` under Authentication → Hooks →
   *Customize Access Token (JWT) Claims*. It stamps `https://web-daw.fly.dev/mcp` as the audience
   of tokens issued to connected apps, and leaves the app's own sign-in tokens alone.
4. **Set the resource URL on Fly:** `fly secrets set MCP_RESOURCE_URL=https://web-daw.fly.dev/mcp`.
   `/mcp` only accepts tokens whose audience is exactly this, and stays off, with a warning in the
   logs, until it is set.

**Why the audience matters.** A token's audience says which service it is for. Checking it means a
token issued for anything else this Supabase project ever serves cannot open the MCP server. It also
works the other way: a connected app's token opens `/mcp` and nothing else, because the app's API
wants `authenticated`.

Who may connect is the same allowlist as the app: an address must be allowed (`allowed_emails`)
and in Google's test-user list to sign in at all.

## Connecting

- **claude.ai / the apps:** Settings → Connectors → *Add custom connector*, with the URL
  `https://web-daw.fly.dev/mcp`. Leave the client id and secret empty, so Claude registers itself.
- **Claude Code:** `claude mcp add --transport http corrente https://web-daw.fly.dev/mcp`.

Either way you are sent to Corrente to sign in, if you are not already, and then asked to approve
the connection.

**Only Claude can be approved.** Dynamic registration means anyone can register an app and call it
"Claude", so the consent page ignores the name and checks where the app receives its code, which it
cannot fake: claude.ai or claude.com over HTTPS, or a loopback address (Claude Code). Anything else
is refused before an Allow button is shown (`src/auth/trustedRedirect.ts`). If Claude ever moves its
callback to a new host, add it there. This is deliberately Claude-only while the server is in initial
testing and development, so other MCP clients cannot connect yet; opening it up is AGENT-29.

## If it fails after you approve

`fly logs` shows `/mcp token refused: <reason>` for every refused token. An `unexpected "aud" claim
value` means the hook is not stamping it: check the hook is selected, and that the URL in it matches
`MCP_RESOURCE_URL`. If the hook stamps nothing at all, Supabase may not put `client_id` on these
tokens; decode one (jwt.io) and match on whatever claim marks it as an OAuth app's instead.

The one step you cannot see is Claude exchanging its code for a token. ai-project-manager found that
Claude authenticates there with `client_secret_post`, so a client registered by hand for
`client_secret_basic` fails at that step with a generic "Authorization failed". Dynamic registration
lets Claude choose its own method. If you ever register a client by hand, pick `client_secret_post`.

## What the hosted server leaves out

- `play`, `stop`, and the live-note tools: there is no audio on the server.
- History other than `commit`.
- Saving patches: your own patches live in your browser. The factory bank works.

Every tool takes an optional `project`, an id or name, which defaults to your most recently edited
project. `list_projects` lists them.
