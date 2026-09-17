---
title: Authentication & Authorization Walkthrough
mode: b            # default drive mode: b = auto-jump editor + links, a = links only
---

# Authentication & Authorization Walkthrough

How web-daw answers two questions on every request: **who are you?** (authentication)
and **are you allowed to touch this project?** (authorization). We follow one request
from the browser to the database, in the order the system actually checks things:
identity is minted at sign-in, rides along on every request, gets verified on the
server, is turned into an allow/deny decision, and finally scopes every database query.

Two ideas make the whole thing small:

- **One shared seam.** The same verification function (`principal.ts`) is reused by
  both the HTTP API and the WebSocket, so there is exactly one place that turns a
  credential into a user.
- **Auth is opt-in.** With the Supabase env vars unset, the app runs open with a
  single dev "local" owner. Production always sets them, so the real gate is always on
  where it matters. Watch for this fork at several stops.

Vocabulary as we go: a **JWT** is a signed token proving who you are; **JWKS** is the
provider's set of public keys used to check that signature; the **principal** is the
verified user; **owner** created a project, a **member** was invited to it.

<!-- Presenter notes are short; expand them live. `symbol` anchors each stop against line drift. -->

## 1. Sign-in and the token source

- file: `src/auth/session.ts`
- lines: 47-83
- symbol: `getAccessToken`

Where identity is born. Supabase is the identity provider: it runs the OAuth redirect,
persists the session in localStorage, refreshes the token, and fires auth events.
`apply()` caches the current JWT (`session.access_token`) on every event; `getAccessToken()`
is the single feed the API/WS clients read. Note `authEnabled` (line 19): unset env means
this whole module no-ops and the app runs open.

## 2. The login gate

- file: `src/ui/AuthGate.tsx`
- lines: 21-41
- symbol: `GatedApp`

What the user sees. Rendered above `AppShell`: a loading card, then a login screen when
signed out, then the app. It also bridges the session's **email** into `currentUser`
(edit attribution uses email because it is unique per account). `GITHUB_ENABLED = false`
(line 68) keeps sign-in Google-only and invite-only during the unhardened window - the
comment there is worth reading for the "why".

## 3. The token rides every request

- file: `src/contract/client.ts`
- lines: 58-64
- symbol: `createApiClient`

How the credential leaves the browser. `authHeaders()` puts `Authorization: Bearer <token>`
on every HTTP call. The token is a **getter** (`TokenSource`, lines 25-29) re-read per
request, so a refreshed JWT applies without rebuilding the client. The WebSocket can't set
headers, so it puts the token on the query string instead - see `connect()` (lines 329-335):
`?token=<jwt>`, URL rebuilt per reconnect.

## 4. Turning real auth on (server bootstrap)

- file: `server/api/index.ts`
- lines: 33-44
- symbol: `auth`

The fork between dev-stub and real auth, decided once at startup. If `SUPABASE_JWKS_URL`
and `SUPABASE_JWT_ISSUER` are both set, `auth` is a config object; otherwise it's
`undefined` (open dev-stub). It's handed to both `createApp(...)` (HTTP) and, just below,
`attachWsServer(...)` (WS) - the same config drives both gates.

## 5. The verification seam (authentication)

- file: `server/api/principal.ts`
- lines: 49-73
- symbol: `makeJwtResolver`

The heart of authentication, and the shared seam. `makeJwtResolver` builds a remote JWKS
key set once, then per credential runs `jwtVerify` - checking signature, issuer, and
audience. Success returns `{ userId: sub, email }` and provisions the user row
(`ensureUser`); **any** failure (bad signature, expired, wrong iss/aud, malformed, absent)
returns `null` = unauthorized. `makeDevResolver` (67-73) is the open stub: one "local"
principal, no credential. Both share the `ResolvePrincipal` type, which is why HTTP and WS
can reuse it verbatim.

## 6. The HTTP gate

- file: `server/api/app.ts`
- lines: 112-123
- symbol: `resolvePrincipal`

Where an HTTP request is admitted or rejected. This middleware pulls the bearer token
(`bearer()`, 50-51), resolves it through the seam, and returns **401** if null; otherwise
it stashes the identity on the request context (`ownerId` + `userEmail`) for the route
handlers. Note the guard: paths outside `/projects` skip the gate, so the single-origin
deploy can serve `index.html`/JS without a 401.

## 7. The owner-or-member predicate (authorization)

- file: `server/db/store.ts`
- lines: 31-49
- symbol: `accessibleWhere`

The heart of authorization, and it lives in the data layer, not the routes. `accessibleWhere`
is a SQL fragment: this project is accessible if **you own it** (`ownerId` matches your user
id) **or** a member row matches your lowercased email. With no email it degrades to a plain
owner check. It drops into any query that was previously "where owner = me", so every read
and write shares one definition of "allowed". `canAccess` (42-49) is the boolean form used
by writes.

## 8. Where owner and membership are defined

- file: `server/db/schema.ts`
- lines: 54-69
- symbol: `projects`

The tables the predicate reads. `projects.ownerId` is a foreign key to `users` (indexed for
the owner lookup) plus a soft-delete column. Then `projectMembers` (127-143): keyed by
`(projectId, email)`, members are identified by **email, not a user FK** - so an owner can
invite someone before they've ever signed up, and the row is claimed implicitly when a
matching verified email logs in.

## 9. Sharing is owner-only

- file: `server/api/app.ts`
- lines: 99-104
- symbol: `requireOwner`

A second, stricter authorization tier for managing who has access. `requireOwner` returns
404 if the project doesn't exist and **403** if the caller isn't its owner. It gates the
member routes (`listMembers`/`addMember`/`removeMember`, ~204-229) and project delete, so a
member can edit a shared project but can't reshare or delete it.

## 10. WebSocket authentication

- file: `server/api/wsServer.ts`
- lines: 46-104
- symbol: `attachWsServer`

The realtime path, mirroring HTTP. At the upgrade (line 52) it reads `?token=` and resolves
it through the **same** seam; failure closes the socket with code 1008. Resolution is async,
so the message handler `await`s it (line 72) - an early `subscribe` is held, not dropped.
Then per-message authorization: a `subscribe` (92-104) must pass `registry.get(projectId,
principal)`, and edits re-check it. (The comment at 46-51 was corrected during this
walkthrough: it originally predated sharing and implied the owner was the only real user, so
it undersold the per-message owner-or-member check the code already does. A good reminder that
comments drift from the code and are worth distrusting until you've read what runs.)

## 11. Authorize, then load the room

- file: `server/api/rooms.ts`
- lines: 260-274
- symbol: `get`

The WS authorization decision. `RoomRegistry.get` calls `resolveProjectAccess` and returns
`null` when the principal is neither owner nor member. The subtle-but-important bit: the room
is loaded under the project's **real owner** (`access.ownerId`), so a member joins the *same*
room and their edits persist under the owner - closing an early hole where the first
subscriber's id got baked in.

## 12. Data-layer scoping, and the gaps to know

- file: `server/db/store.ts`
- lines: 151-192
- symbol: `writeFile`

The last line of defense: even past every gate, the query itself is scoped. `writeFile`
create-stamps a brand-new project to its writer as owner (`onConflictDoNothing`, so a repeat
never re-stamps), then gates on `canAccess`, and treats `history/commits/*` as write-once.
Every read (`listProjects`, `readFile`) is filtered by `accessibleWhere` too.

Gaps worth carrying in your head (all deliberate, for the unhardened window):
the **dev-stub open path** still exists for local dev, but it now **fails closed in
production** - `resolveAuthConfig` (principal.ts) throws under `NODE_ENV=production`
when the Supabase env is unset, so a misconfigured deploy refuses to boot rather than
running open (HOST-8.4); **no rate-limiting or per-owner quotas** yet (only a body-size
cap); **CORS defaults to `*`** (the bearer token, not a cookie, is the gate); the JWT
**audience is hard-coded** to `"authenticated"`. These map to the roadmap's `HOST-8`
hardening tickets.
