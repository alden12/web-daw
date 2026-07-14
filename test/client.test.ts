/**
 * The token source on `createApiClient`. Auth-B made the bearer token lazy - either a fixed string or a
 * getter re-read per request - so a refreshed Supabase session token takes effect without rebuilding the
 * client. These stub `fetch` and assert the Authorization header each call actually carries.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/contract/client";

/** Replace global fetch with a stub that records each call's init and returns an empty project list. */
function stubFetch(): RequestInit[] {
  const calls: RequestInit[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(JSON.stringify({ ids: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const authOf = (init: RequestInit): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.["Authorization"];

afterEach(() => vi.unstubAllGlobals());

describe("createApiClient token source", () => {
  it("sends a static string token as a Bearer header", async () => {
    const calls = stubFetch();
    await createApiClient({ baseUrl: "http://x", token: "abc" }).listProjects();
    expect(authOf(calls[0])).toBe("Bearer abc");
  });

  it("evaluates a token getter per request, so a refreshed token takes effect", async () => {
    const calls = stubFetch();
    let token = "t1";
    const client = createApiClient({ baseUrl: "http://x", token: () => token });
    await client.listProjects();
    token = "t2"; // simulate a session refresh between requests
    await client.listProjects();
    expect(authOf(calls[0])).toBe("Bearer t1");
    expect(authOf(calls[1])).toBe("Bearer t2");
  });

  it("sends no auth header when there is no token (getter returns undefined)", async () => {
    const calls = stubFetch();
    await createApiClient({ baseUrl: "http://x", token: () => undefined }).listProjects();
    expect(authOf(calls[0])).toBeUndefined();
  });
});
