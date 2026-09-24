/**
 * The OAuth consent page (AGENT-28): where Supabase's OAuth server sends a person to approve an app,
 * such as Claude, connecting to Corrente's hosted MCP server.
 *
 * It sits behind the same login gate as the rest of the app, so the sign-in is Corrente's own and
 * there is no second login screen to keep in step with the first. It only offers to approve an app
 * that receives its code at one of Claude's addresses, and refuses anything else outright: an app can
 * call itself anything, but it cannot make the redirect point somewhere it does not control
 * (trustedRedirect.ts).
 */
import { useEffect, useState } from "react";
import { decideConsent, readConsentRequest, type ConsentRequest } from "../auth/session";
import { GateCard } from "./AuthGate";

type Screen = ConsentRequest | { kind: "loading" } | { kind: "deciding" };

const authorizationIdFromLocation = (): string | null =>
  new URLSearchParams(window.location.search).get("authorization_id");

export function OAuthConsent() {
  const authorizationId = authorizationIdFromLocation();
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    if (!authorizationId) return;
    void readConsentRequest(authorizationId).then(setScreen);
  }, [authorizationId]);

  // Following a redirect is the end of this page: already approved, or just decided.
  useEffect(() => {
    if (screen.kind === "redirect") window.location.href = screen.url;
  }, [screen]);

  const decide = (approve: boolean) => {
    if (!authorizationId) return;
    setScreen({ kind: "deciding" });
    void decideConsent(authorizationId, approve).then(setScreen);
  };

  if (!authorizationId) return <Message title="Nothing to approve" body="This link has no request in it." />;
  if (screen.kind === "error") return <Message title="That request has expired" body={screen.message} />;
  if (screen.kind === "refused")
    return (
      <Message
        title="Corrente only connects to Claude"
        body={`This request would send access to ${screen.redirectOrigin}, which is not Claude, so it has been stopped. To connect Claude, start again from its connector settings.`}
      />
    );
  if (screen.kind !== "ask") return <Message title="One moment" body="Checking the request..." />;
  return (
    <GateCard>
      <h2 id="auth-title" className="text-lg font-semibold text-strong">
        Connect {screen.clientName} to Corrente?
      </h2>
      <p className="text-sm text-muted leading-relaxed">
        It will be able to read and edit your projects as <span className="text-ink">{screen.email}</span>. Its edits
        show as the agent's, and you can undo them.
      </p>
      <p className="text-xs text-faint leading-relaxed">
        Access is sent to <span className="font-mono text-ink">{screen.redirectOrigin}</span>.
      </p>
      <div className="mt-1 flex gap-2 w-full">
        <button
          type="button"
          onClick={() => decide(false)}
          className="flex-1 font-mono text-sm font-semibold px-5 py-2.5 rounded-lg border border-line bg-card text-ink hover:border-faint cursor-pointer"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          className="flex-1 font-mono text-sm font-semibold px-5 py-2.5 rounded-lg border border-you bg-you text-ground hover:opacity-90 cursor-pointer"
        >
          Allow
        </button>
      </div>
    </GateCard>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <GateCard>
      <h2 id="auth-title" className="text-lg font-semibold text-strong">
        {title}
      </h2>
      <p className="text-sm text-muted leading-relaxed">{body}</p>
    </GateCard>
  );
}
