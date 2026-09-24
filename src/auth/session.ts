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
import { isTrustedRedirect } from "./trustedRedirect";

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
  if (session) resumeConsent();
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
const RETURN_PATH_KEY = "corrente:auth-return";

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
  // The consent page is the one path whose query is the point (its `authorization_id`), and it holds
  // no provider `?code=` at this moment - the code only arrives on the way back, at the origin.
  // The consent page is remembered by its canonical path, however the tab spelled it.
  const onConsent = isConsentPath(window.location.pathname);
  const here = onConsent ? OAUTH_CONSENT_PATH + window.location.search : window.location.pathname;
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(RETURN_PATH_KEY, here);
  await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
}

/** Sign out (clears the persisted session). No-op if auth is off. */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Where Supabase's OAuth server sends a person to approve an app, such as Claude, connecting to
 * Corrente's hosted MCP server (AGENT-28). The Supabase project's OAuth server settings point here.
 */
export const OAUTH_CONSENT_PATH = "/oauth/consent";

/** Whether a path is the consent page, forgiving a trailing or doubled slash: a Site URL ending in
 *  `/` joined to the authorization path gives `//oauth/consent`, which must not open the DAW. */
export const isConsentPath = (pathname: string): boolean =>
  pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") === OAUTH_CONSENT_PATH;

/**
 * Back to a consent request that sent this tab off to sign in.
 *
 * Sign-in returns to the origin (see `signInWithProvider`), where the app would boot and the request
 * would be lost. Run once a session exists, which is after the provider's code has been exchanged -
 * leaving before that would take the code with it.
 */
function resumeConsent(): void {
  if (typeof sessionStorage === "undefined" || typeof window === "undefined") return;
  const path = sessionStorage.getItem(RETURN_PATH_KEY);
  // A prefix check on a path we stored ourselves, never a parse: `//host/...` parses as another site.
  if (!path?.startsWith(`${OAUTH_CONSENT_PATH}?`) || isConsentPath(window.location.pathname)) return;
  sessionStorage.removeItem(RETURN_PATH_KEY);
  window.location.replace(path);
}

/** A consent request as the page needs it: something to ask, somewhere to go, or why not. */
export type ConsentRequest =
  | { kind: "ask"; clientName: string; redirectOrigin: string; email: string }
  | { kind: "redirect"; url: string }
  /** It would send access somewhere that is not Claude (see trustedRedirect.ts). */
  | { kind: "refused"; redirectOrigin: string }
  | { kind: "error"; message: string };

const originOf = (uri: string): string => (URL.canParse(uri) ? new URL(uri).origin : uri);

/** Follow a redirect only to Claude; anywhere else is refused, whatever Supabase says. */
const redirectTo = (url: string): ConsentRequest =>
  isTrustedRedirect(url) ? { kind: "redirect", url } : { kind: "refused", redirectOrigin: originOf(url) };

/**
 * Read an authorization request. Already approved (the same app connecting again) comes back as just
 * a redirect, which the page follows without asking twice.
 */
export async function readConsentRequest(authorizationId: string): Promise<ConsentRequest> {
  if (!supabase) return { kind: "error", message: "Sign-in is not configured on this server." };
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return { kind: "error", message: error?.message ?? "That request could not be found." };
  if ("redirect_url" in data) return redirectTo(data.redirect_url);
  // An app can call itself anything, but not receive its code anywhere but where it says.
  const redirectOrigin = originOf(data.redirect_uri);
  if (!isTrustedRedirect(data.redirect_uri)) return { kind: "refused", redirectOrigin };
  return { kind: "ask", clientName: data.client.name, redirectOrigin, email: data.user.email };
}

/** Approve or deny, returning where the app wants the browser next. */
export async function decideConsent(authorizationId: string, approve: boolean): Promise<ConsentRequest> {
  if (!supabase) return { kind: "error", message: "Sign-in is not configured on this server." };
  const options = { skipBrowserRedirect: true };
  const { data, error } = approve
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
    : await supabase.auth.oauth.denyAuthorization(authorizationId, options);
  if (error || !data) return { kind: "error", message: error?.message ?? "That request could not be completed." };
  return redirectTo(data.redirect_url);
}
