/**
 * The login gate. When Supabase auth is configured (`authEnabled`), the app renders here first: a brief
 * loading card while the stored session resolves, a login screen when signed out, and the app itself once
 * signed in. When auth is off it renders the app straight through (local/dev, unchanged).
 *
 * Gating ABOVE AppShell is deliberate: AppShell builds the AudioEngine/Scheduler eagerly in its state
 * initializers, so it must not mount behind the login screen. On sign-in the gate bridges the session's
 * display name into `currentUser` (the author stamped on edits); AppShell's own effects re-derive from
 * that store, so nothing else needs to know about the session.
 */
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { authEnabled, readAuthState, subscribeAuth, signInWithProvider } from "../auth/session";
import { writeCurrentUser, DEFAULT_USER } from "./currentUser";

export function AuthGate({ children }: { children: ReactNode }) {
  // No hooks here so the early return is safe; the gated path lives in its own component.
  if (!authEnabled) return <>{children}</>;
  return <GatedApp>{children}</GatedApp>;
}

function GatedApp({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, readAuthState, readAuthState);

  // Keep the edit-author identity in step with the session (reset to the default on sign-out). We stamp
  // the EMAIL, not the display name: it's unique per account (two logins of the same person share a name
  // but not an email), so collaborators stay distinct in the feed and in colour. The readable display
  // name still drives the account avatar/panel; only edit attribution uses the email.
  const identity =
    state.status === "signed-in"
      ? (state.user.email ?? state.user.name)
      : state.status === "signed-out"
        ? DEFAULT_USER
        : null;
  useEffect(() => {
    if (identity) writeCurrentUser(identity);
  }, [identity]);

  if (state.status === "loading") return <GateCard>{<p className="text-sm text-muted">Signing in...</p>}</GateCard>;
  if (state.status === "signed-out") return <LoginScreen />;
  return <>{children}</>;
}

/** The StartDialog-style centered card (matches src/ui/StartDialog.tsx), with the brand orb. */
function GateCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="bg-panel border border-line rounded-2xl p-8 max-w-sm mx-4 text-center flex flex-col items-center gap-4 shadow-2xl">
        <span
          className="w-9 h-9 rounded-full"
          style={{ background: "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))" }}
        />
        {children}
      </div>
    </div>
  );
}

function LoginScreen() {
  return (
    <GateCard>
      <h2 id="auth-title" className="text-lg font-semibold text-bright">
        Sign in to web-daw
      </h2>
      <p className="text-sm text-muted leading-relaxed">
        Your projects sync to your account. Sign in to pick up where you left off, from any device.
      </p>
      <div className="mt-1 flex flex-col gap-2 w-full">
        <ProviderButton provider="github" label="Continue with GitHub" />
        <ProviderButton provider="google" label="Continue with Google" />
        <p className="text-[11px] text-faint leading-relaxed">
          Google sign-in is limited to invited test accounts for now - use GitHub if you're not on the list.
        </p>
      </div>
    </GateCard>
  );
}

function ProviderButton({ provider, label }: { provider: "google" | "github"; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void signInWithProvider(provider)}
      className="w-full font-mono text-sm font-semibold px-5 py-2.5 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
    >
      {label}
    </button>
  );
}
