/**
 * The token source on `createApiClient`. Auth-B made the bearer token lazy - either a fixed string or a
 * getter re-read per request - so a refreshed Supabase session token takes effect without rebuilding the
 * client. Auth-C added the sharing (member) methods. These stub `fetch` and assert the request each call
 * actually issues (auth header, method, URL, body).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/contract/client";

/** Replace global fetch with a stub that records each call's url + init and returns `body` (default an
 *  empty project list). */
function stubFetch(body: unknown = { projects: [] }): { url: string; init: RequestInit }[] {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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
    expect(authOf(calls[0].init)).toBe("Bearer abc");
  });

  it("evaluates a token getter per request, so a refreshed token takes effect", async () => {
    const calls = stubFetch();
    let token = "t1";
    const client = createApiClient({ baseUrl: "http://x", token: () => token });
    await client.listProjects();
    token = "t2"; // simulate a session refresh between requests
    await client.listProjects();
    expect(authOf(calls[0].init)).toBe("Bearer t1");
    expect(authOf(calls[1].init)).toBe("Bearer t2");
  });

  it("sends no auth header when there is no token (getter returns undefined)", async () => {
    const calls = stubFetch();
    await createApiClient({ baseUrl: "http://x", token: () => undefined }).listProjects();
    expect(authOf(calls[0].init)).toBeUndefined();
  });
});

describe("createApiClient sharing (member) methods", () => {
  it("GETs the members list", async () => {
    const calls = stubFetch({ members: [{ email: "b@x.com", role: "editor" }] });
    const members = await createApiClient({ baseUrl: "http://x" }).getMembers("p1");
    expect(members).toEqual([{ email: "b@x.com", role: "editor" }]);
    expect(calls[0].url).toBe("http://x/projects/p1/members");
  });

  it("POSTs an invite with the email in the body", async () => {
    const calls = stubFetch({ ok: true });
    await createApiClient({ baseUrl: "http://x" }).addMember("p1", "b@x.com");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].url).toBe("http://x/projects/p1/members");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: "b@x.com" });
  });

  it("DELETEs a member by url-encoded email", async () => {
    const calls = stubFetch({});
    await createApiClient({ baseUrl: "http://x" }).removeMember("p1", "b@x.com");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe("http://x/projects/p1/members/b%40x.com");
  });

  it("throws with the server's error message when an invite is rejected", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(createApiClient({ baseUrl: "http://x" }).addMember("p1", "bad")).rejects.toThrow("400");
  });
});
