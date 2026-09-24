/**
 * The consent page is found by its path (AGENT-28), and a Site URL ending in `/` joined to the
 * authorization path spells it `//oauth/consent` - which opened the DAW instead of asking.
 */
import { describe, expect, it } from "vitest";
import { isConsentPath } from "../src/auth/session";

describe("isConsentPath", () => {
  it("matches the consent page however the slashes fall", () => {
    expect(isConsentPath("/oauth/consent")).toBe(true);
    expect(isConsentPath("/oauth/consent/")).toBe(true);
    expect(isConsentPath("//oauth/consent")).toBe(true);
    expect(isConsentPath("/oauth//consent")).toBe(true);
  });

  it("matches nothing else", () => {
    expect(isConsentPath("/")).toBe(false);
    expect(isConsentPath("/oauth")).toBe(false);
    expect(isConsentPath("/oauth/consent/extra")).toBe(false);
    expect(isConsentPath("/p/oauth/consent")).toBe(false);
  });
});
