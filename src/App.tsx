import { AppShell } from "./ui/AppShell";
import { AuthGate } from "./ui/AuthGate";
import { OAuthConsent } from "./ui/OAuthConsent";
import { OAUTH_CONSENT_PATH } from "./auth/session";

function App() {
  // The consent page is the one route that is not the app (AGENT-28): an app asking to connect to the
  // hosted MCP server lands here, signed in through the same gate.
  const consent = window.location.pathname === OAUTH_CONSENT_PATH;
  return <AuthGate>{consent ? <OAuthConsent /> : <AppShell />}</AuthGate>;
}

export default App;
