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
3. **Nothing else.** In particular, no custom access token hook. ai-project-manager needs one to
   stamp its own URL as the token audience. Corrente does not, because this Supabase project mints
   tokens for Corrente alone, and the API already accepts any of them.

Who may connect is the same allowlist as the app: an address must be allowed (`allowed_emails`)
and in Google's test-user list to sign in at all.

## Connecting

- **claude.ai / the apps:** Settings → Connectors → *Add custom connector*, with the URL
  `https://web-daw.fly.dev/mcp`. Leave the client id and secret empty, so Claude registers itself.
- **Claude Code:** `claude mcp add --transport http corrente https://web-daw.fly.dev/mcp`.

Either way you are sent to Corrente to sign in, if you are not already, and then asked to approve
the connection. Check the address it shows: an app can call itself anything, but it cannot make
that address one it does not control.

## If it fails after you approve

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
