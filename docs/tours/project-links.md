---
title: Project Links Walkthrough
mode: b
diff-base: slice-99-note-pads # the parent slice, and this PR's base; sections show as diffs
---

# Project Links Walkthrough

How a project got a URL you can send someone (HOST-17). Two sentences of feature, and then
three edges that turned out to matter more than the feature: what a link has to survive, what
happens when it names a project you cannot see, and what a sign-in round trip does to it.

Five stops: the link format, the address bar as a reflection rather than navigation, the boot
that honours a link, the fallback when it names nothing real, and the OAuth detour that broke
it once already. **If you want the short version, sections 1, 3 and 5 carry the ideas.**

Two things worth knowing before we start:

- **Deliberately the smallest thing that works.** No router, no history stack, no navigation.
  Routing and sharing are not designed yet, and this is scoped so that designing them later is
  not a migration. If a second thing ever becomes worth addressing (a clip, a version, a view),
  that is the moment to build routing properly rather than to extend this.
- **Deep links already worked server-side.** `server/api/index.ts:53` has served `index.html`
  for any unmatched path since the single-origin image landed, so `/p/...` needed nothing new
  on the server - a nice accident of having built the static fallback correctly the first time.

## 1. The link format: an id you can rely on, a name you can read

- file: `src/ui/projectUrl.ts`
- lines: 14-46
- symbol: `projectPath`

`/p/deep-house-jam~p-1a2b3c4d`. **The id is the identity and the slug is decoration** - a link
has to survive a rename, and two projects can share a name, so what gets resolved is the id and
the readable half is only there so the link tells you what it opens.

The `~` is doing real work: `projectSlug` can never produce one, so `lastIndexOf` splits the
path unambiguously no matter what an id looks like - and they are not all one shape, since the
first project on a fresh install is literally `default`.

Related: [test/projectUrl.test.ts:24](test/projectUrl.test.ts#L24) round-trips the pair through
names built to break it (all punctuation, a name containing `/`, a name containing `~`).

## 2. A reflection, not navigation

- file: `src/ui/projectUrl.ts`
- lines: 55-67
- symbol: `syncProjectUrl`

`replaceState`, not `pushState`. Opening a project is not navigation here, and a history entry
you could press "back" on **without the app switching projects** would be a lie the browser
tells on our behalf.

The other half of "the URL always names what is open" is that project switches have to reach
this. `setCurrentProject` was a silent write, so the branch gives it a listener set and
`AppShell` subscribes with `useSyncExternalStore` - which is why renaming or switching in the
project menu moves the address bar with no wiring at either call site.

Related: [src/audio/projectRepository.ts:466](src/audio/projectRepository.ts#L466)
(`subscribeCurrentProject`).

## 3. Read once, before anything can write over it

- file: `src/ui/AppShell.tsx`
- lines: 179-197
- symbol: `linkedProjectId`

The ordering here is the whole trick, and it is easy to get wrong. The effect below points the
address bar at the open project as soon as it loads - so **a link read any later would be
reading what we had just written over it**. The `useRef` initialiser captures it at first
render and hands it to boot.

The `projectLoaded` guard is the same hazard from the other side: until the library has opened
something, the current id is a placeholder, and syncing it would clobber the link we were asked
to open before we had opened it.

## 4. A link to a project you cannot see

- file: `src/audio/projects/operations.ts`
- lines: 56-99
- symbol: `initProjects`

`preferId` wins over the persisted current, but **only if the project is actually there**. The
`ifPresent` check is not defensive tidying - without it, arriving on someone else's link would
seed a fresh local project under their id, which then syncs, and now two projects claim one
identity.

Boot reads three candidates in priority order (the link, the persisted current, the newest) and
the first two can *both* name something gone, so both go through the same predicate. That is
also why boot is the one operation here taking an options object rather than the trailing
`storage` parameter the other five use: it is the only one with a second thing to say.

Because the URL is a reflection (section 2), the failure explains itself: you land on your own
project and the address bar rewrites to say so.

## 5. The round trip that lost the project

- file: `src/auth/session.ts`
- lines: 79-110
- symbol: `signInWithProvider`

The bug this section exists for: signing in from a `/p/...` link on localhost dumped you on the
deployed Fly site. **Supabase matches `redirectTo` against an allow-list and silently falls back
to the configured Site URL when it does not match** - no error, no warning, just a different
origin. Production would have hit it too, losing the project rather than the origin.

So the redirect goes to the origin (already allow-listed by definition - it is how signing in
works at all) and the path rides in `sessionStorage` instead. Per-tab, consumed on read, and
deliberately the path only: carrying the query back would re-inject the provider's own `?code=`
on the next boot.

Related: [e2e/project-link.e2e.ts:64](e2e/project-link.e2e.ts#L64) replays that return by
seeding the key and loading the bare origin, which is exactly what the provider does to us.
