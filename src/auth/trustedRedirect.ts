/**
 * Which apps the consent page will hand access to (AGENT-28), judged by where the app receives it.
 *
 * Dynamic client registration is on, because Claude registers itself as it connects, so anyone can
 * register an app and call it "Claude". The name proves nothing; the redirect does, because an app
 * can only receive its code at an address it controls. So rather than trust a person to read the
 * address, the page refuses outright unless it is one of Claude's: claude.ai or claude.com for the
 * web and the apps, and a loopback address for Claude Code, which listens on a local port.
 *
 * Only the signed-in person's browser can approve, so refusing here closes the door fully - there is
 * no other way to say yes.
 */

/** Claude's own hosts, exactly (no subdomains), over HTTPS. */
const CLAUDE_HOSTS = ["claude.ai", "claude.com"];

/** This machine, on any port: where Claude Code listens for its code. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function isTrustedRedirect(uri: string): boolean {
  const url = URL.canParse(uri) ? new URL(uri) : null;
  if (!url) return false;
  if (url.protocol === "https:" && CLAUDE_HOSTS.includes(url.hostname)) return true;
  return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTS.includes(url.hostname);
}
