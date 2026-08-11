/**
 * The client auth seam: a thin wrapper over Supabase Auth that the rest of the app reads through two
 * points - `getAccessToken()` (the token fed to the HTTP/WS clients) and the `readAuthState`/
 * `subscribeAuth` store (the login gate). Supabase is an identity provider only: it runs the OAuth
 * redirect, persists the session in localStorage, refreshes the token, and emits auth events; we cache
 * the current token + a small `AuthState` off those events. Keeping all of that behind this one module
 * is what makes the provider swappable later (only this file imports `@supabase/supabase-js`).
 *
 * Auth is OPT-IN via env: with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` unset the app runs exactly
 * as before real auth (no gate, no credential - the dev-stub server is open, a single "local" owner). No
 * React here - the UI bridges this store to `currentUser` and renders the gate.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env?.VITE_SUPABASE_URL;
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

/** True when Supabase auth is configured. When false the app skips the login gate entirely. */
export const authEnabled = Boolean(url && anonKey);

export interface AuthUser {
  id: string;
  email?: string;
  /** A human display name for the feed/colours (OAuth name, else email, else id). */
  name: string;
}

/** `loading` until the first auth event resolves; then `signed-in` (with the user) or `signed-out`. */
export type AuthState = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: AuthUser };

const listeners = new Set<() => void>();
const supabase: SupabaseClient | null = authEnabled ? createClient(url as string, anonKey as string) : null;

// A fresh object per change so `readAuthState` is a stable snapshot between notifications (useSyncExternalStore).
let state: AuthState = authEnabled ? { status: "loading" } : { status: "signed-out" };
let token: string | undefined;

/** Prefer the OAuth-provided display name, then email, then the opaque id - so the feed reads nicely. */
function displayName(session: Session): string {
  const meta = session.user.user_metadata as Record<string, unknown>;
  const named = [meta.full_name, meta.user_name, meta.name].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return named ?? session.user.email ?? session.user.id;
}

function apply(session: Session | null): void {
  token = session?.access_token;
  state = session
    ? {
        status: "signed-in",
        user: { id: session.user.id, email: session.user.email ?? undefined, name: displayName(session) },
      }
    : { status: "signed-out" };
  for (const listener of listeners) listener();
}

// One handler keeps the token + state current. `onAuthStateChange` fires an INITIAL_SESSION event on
// load (the stored session or null), plus SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED.
if (supabase) supabase.auth.onAuthStateChange((_event, session) => apply(session));

/** The credential for the API/WS clients: the live session JWT when auth is on, else none (the dev-stub
 *  server is open). */
export function getAccessToken(): string | undefined {
  return authEnabled ? token : undefined;
}

/** Current auth state (a stable snapshot; changes only alongside a `subscribeAuth` notification). */
export function readAuthState(): AuthState {
  return state;
}

/** Subscribe to auth-state changes. Returns an unsubscribe fn. */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Where we were when we left for the provider, so the round trip can put us back (HOST-17). */
const RETURN_PATH_KEY = "web-daw:auth-return";

/**
 * The path this tab was on before it left to sign in, consumed on read.
 *
 * `sessionStorage`, so it is this tab's and does not outlive the visit, and **the path only** -
 * carrying the query back would re-inject the provider's own `?code=` on the next boot.
 */
export function takeAuthReturnPath(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const path = sessionStorage.getItem(RETURN_PATH_KEY);
  sessionStorage.removeItem(RETURN_PATH_KEY);
  return path;
}

/**
 * Begin an OAuth sign-in (redirects to the provider, then back to this origin). No-op if auth
 * is off.
 *
 * **Back to the origin, with the path remembered separately** rather than passed as `redirectTo`.
 * Supabase matches `redirectTo` against its allow-list and silently falls back to the project's
 * configured Site URL when it does not match - so asking to return to `/p/<project>` sent a
 * localhost tab to the deployed site, and would have dropped the project even in production
 * unless the allow-list carried a `/**` entry for every origin. Remembering the path here needs
 * no dashboard configuration at all, and the origin is already allow-listed by definition: it is
 * how signing in works today.
 */
export async function signInWithProvider(provider: "google" | "github"): Promise<void> {
  if (!supabase) return;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(RETURN_PATH_KEY, window.location.pathname);
  await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
}

/** Sign out (clears the persisted session). No-op if auth is off. */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
