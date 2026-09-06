/**
 * A throwaway MCP Apps server, mounted only to answer AGENT-27's remaining questions (2026-09-06).
 *
 * **Delete this whole module once they are answered.** It exists because those questions are all
 * about *host behaviour* - what CSP Claude actually applies, whether a view's origin survives
 * between tool calls, whether `ui/update-model-context` really reaches the model - and none of them
 * can be answered from a page we host ourselves. They need a real MCP App, rendered by a real host.
 *
 * **Unauthenticated on purpose, and safe because it touches nothing.** The API's auth middleware
 * gates `/projects` only, so this needs no exemption. It reads no database, holds no state and
 * serves one static HTML resource plus one static worklet, so there is nothing here to protect.
 *
 * **Hand-rolled JSON-RPC rather than the SDK's transport.** Stateless streamable HTTP is a POST
 * carrying one JSON-RPC request and a JSON response back, which is little enough code that the
 * SDK's session plumbing would be the larger half - and this needs exact control over the
 * `_meta.ui` fields the apps extension defines, which the SDK does not model yet.
 *
 * Wire up: `Customize -> Connectors -> Add custom connector`, pointing at `<origin>/mcp`.
 */
import { Hono } from "hono";
import { PROBE_WORKLET_SOURCE, probeScriptSource, probeViewHtml } from "./mcpProbeView";

/** The apps extension identifier (SEP-1865, final 2026-01-26). */
const UI_EXTENSION = "io.modelcontextprotocol/ui";
/** The one content type the extension's first version defines. Must match exactly. */
const UI_MIME = "text/html;profile=mcp-app";
const VIEW_URI = "ui://webdaw-probe/sandbox";
/** Echoed back when the client does not name one. */
const FALLBACK_PROTOCOL = "2025-06-18";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * **What the host has actually done, which turned out to be the diagnostic that mattered.**
 *
 * Five runs produced no view and no callback, while the tool's own return text updated correctly -
 * so edits reach the model fine and something upstream of the view is not happening. Guessing from
 * the outside had cost four deploys, so the server now records what it is asked for.
 *
 * The decisive fact is whether the client declares `io.modelcontextprotocol/ui` at `initialize`,
 * and whether it ever calls `resources/read`. A host that renders MCP Apps must do both. If it
 * does neither, no amount of fixing the view will help, because nothing is ever fetching it.
 */
/** When this process started. The counters are in-memory, so this is how to read them honestly. */
const processStartedAt = Date.now();

const hostLog = {
  clientInfo: null as unknown,
  clientCapabilities: null as unknown,
  protocolVersion: null as string | null,
  methodCounts: {} as Record<string, number>,
  resourcesReadAt: null as string | null,
};

/** Whether the client said it can render MCP Apps. The single most informative field here. */
function declaresUiExtension(): boolean {
  const capabilities = hostLog.clientCapabilities as { extensions?: Record<string, unknown> } | null;
  return Boolean(capabilities?.extensions && UI_EXTENSION in capabilities.extensions);
}

/** A short, readable account of the host's behaviour, returned in the tool result. */
function hostReport(): string {
  const upSeconds = Math.round((Date.now() - processStartedAt) / 1000);
  /**
   * **Say how old the process is, always.** Fly runs this with `auto_stop_machines = "stop"` and
   * `min_machines_running = 0`, so the single machine (`max_machines_running = 1`, hence never
   * more than one) halts when idle and cold-starts on the next request. Every stop wipes these
   * counters, and so does every deploy.
   *
   * Without this line, "no initialize seen" reads as "the host never handshook" when it usually
   * means "this process is twenty seconds old and the host's session predates it". That misreading
   * cost a round trip and produced a confident diagnosis of multi-instance routing, which cannot
   * happen here.
   */
  const age = `process uptime: ${upSeconds}s (counters reset on every restart and deploy)`;
  if (!hostLog.protocolVersion) {
    return [
      "No initialize seen yet by THIS PROCESS.",
      age,
      upSeconds < 120
        ? "It is young, so this most likely means it cold-started under an existing connection rather than that the host never handshook. Reconnect the connector to force a fresh initialize, then run again."
        : "It has been up a while, so a host that has not sent initialize is genuinely not handshaking.",
    ].join("\n");
  }
  const calls = Object.entries(hostLog.methodCounts)
    .map(([method, count]) => `${method} x${count}`)
    .join(", ");
  return [
    `protocol: ${hostLog.protocolVersion}`,
    `client: ${JSON.stringify(hostLog.clientInfo)}`,
    `declares ${UI_EXTENSION}: ${declaresUiExtension() ? "YES" : "NO"}`,
    `client capabilities: ${JSON.stringify(hostLog.clientCapabilities)}`,
    `resources/read ever called: ${hostLog.resourcesReadAt ?? "NEVER"}`,
    `methods seen: ${calls || "(none)"}`,
    age,
  ].join("\n");
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * The public origin this server is reachable at, which has to appear in the view's declared CSP
 * domains AND in the URLs the view fetches. Taken from the request rather than configured, so it
 * is correct on Fly, on a tunnel and locally without anything to keep in step.
 */
function publicOrigin(requestUrl: string, forwardedHost?: string, forwardedProto?: string): string {
  const url = new URL(requestUrl);
  return `${forwardedProto ?? url.protocol.replace(":", "")}://${forwardedHost ?? url.host}`;
}

/**
 * The whole point of the exercise. The spec's default CSP is `script-src 'self' 'unsafe-inline'`,
 * which excludes `blob:` - and worklet modules are governed by `script-src`. Declaring this origin
 * should let the view load its AudioWorklet cross-origin instead, and `connectDomains` should let
 * it `fetch` here at all.
 */
const uiResourceMeta = (origin: string) => ({
  csp: { connectDomains: [origin], resourceDomains: [origin] },
  prefersBorder: true,
});

const viewResource = (origin: string) => ({
  uri: VIEW_URI,
  name: "Sandbox probe",
  description: "Reports what this host's sandbox permits.",
  mimeType: UI_MIME,
  /**
   * Emitted under BOTH `ui` and the fully-qualified extension id. The draft spec writes the short
   * form, but MCP convention namespaces `_meta` keys by reverse-DNS to avoid collisions, and the
   * host is speaking protocol 2025-11-25 rather than the draft this was written against. Sending
   * both costs a few bytes and removes a guess.
   */
  _meta: { ui: uiResourceMeta(origin), [UI_EXTENSION]: uiResourceMeta(origin) },
});

const probeTool = {
  name: "run_sandbox_probe",
  description:
    "Render a diagnostic view that reports what this host's sandbox permits: whether custom " +
    "AudioWorklet DSP can load and run, whether storage survives between invocations, and whether " +
    "the view can reach the model. Call it twice to test invocation-to-invocation persistence.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  // Nothing is changed anywhere, so a host has no reason to gate this behind approval. Also the
  // signal for whether this host gates app-initiated calls at all.
  annotations: { readOnlyHint: true },
  // Both shapes, for the same reason as the resource's metadata above.
  _meta: {
    ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] },
    [UI_EXTENSION]: { resourceUri: VIEW_URI, visibility: ["model", "app"] },
  },
};

/**
 * The channel that actually matters for "agent ears", and the reason there are two tools.
 *
 * A first run showed the model sees **only the tool result**: the view rendered and ran its
 * checks, and the model could say nothing about what they found. `ui/update-model-context` is for
 * context, not results, and appears to be advisory at best. So the view reports by *calling a
 * tool*, whose result enters the conversation the ordinary way and is therefore something the
 * model can reason about.
 *
 * That is the shape a real analysis would take too: render offline, measure, hand the numbers back
 * through a tool call. `visibility: ["app"]` keeps it off the model's own tool list, since it is
 * the view's way of speaking, not something the model should ever decide to call.
 */
const reportTool = {
  name: "report_probe_results",
  description: "Called by the probe view to report what it found, so the model can read it.",
  inputSchema: {
    type: "object",
    properties: { summary: { type: "string" }, results: { type: "array", items: { type: "object" } } },
    required: ["summary"],
    additionalProperties: true,
  },
  annotations: { readOnlyHint: true },
  _meta: { ui: { visibility: ["app"] }, [UI_EXTENSION]: { visibility: ["app"] } },
};

/** Method -> result. Notifications return undefined, which is answered with 202 and no body. */
const handlers: Record<string, (params: Record<string, unknown>, origin: string) => unknown> = {
  initialize: (params) => {
    hostLog.protocolVersion = (params?.protocolVersion as string) ?? FALLBACK_PROTOCOL;
    hostLog.clientInfo = params?.clientInfo ?? null;
    hostLog.clientCapabilities = params?.capabilities ?? null;
    return {
      protocolVersion: (params?.protocolVersion as string) ?? FALLBACK_PROTOCOL,
      capabilities: {
        tools: {},
        resources: {},
        extensions: { [UI_EXTENSION]: { mimeTypes: [UI_MIME] } },
      },
      serverInfo: { name: "webdaw-sandbox-probe", version: "1.0.0" },
    };
  },
  ping: () => ({}),
  /**
   * Not in the spec, but this host asks for it once per connection. Answering emptily rather than
   * with "method not found" costs nothing and removes the possibility that an error here is what
   * stops it going on to fetch the view.
   */
  "server/discover": (_params, origin) => ({ resources: [viewResource(origin)], tools: [probeTool, reportTool] }),
  "tools/list": () => ({ tools: [probeTool, reportTool] }),
  "resources/list": (_params, origin) => ({ resources: [viewResource(origin)] }),
  "resources/read": (params, origin) => {
    hostLog.resourcesReadAt = new Date().toISOString();
    if (params?.uri !== VIEW_URI) throw new Error(`unknown resource: ${String(params?.uri)}`);
    return { contents: [{ uri: VIEW_URI, mimeType: UI_MIME, text: probeViewHtml(origin) }] };
  },
  "tools/call": (params) => {
    const name = params?.name;
    // The view reporting back. Echoed into the result verbatim, which is what puts it in front of
    // the model - and whether that happens at all is the thing being measured.
    if (name === "report_probe_results") {
      const args = (params?.arguments ?? {}) as { summary?: string; results?: unknown[] };
      const summary = args.summary ?? "(no summary)";
      // Deliberately in BOTH: see the note on `structuredContent` below.
      return {
        content: [{ type: "text", text: `Probe view reported:\n\n${summary}` }],
        structuredContent: { summary, results: args.results ?? [] },
      };
    }
    if (name !== "run_sandbox_probe") throw new Error(`unknown tool: ${String(name)}`);
    /**
     * **No `structuredContent` here, and that is the fix for a real mistake.** A run on Claude
     * Desktop reported the entire tool result as `{"renderedAt":"..."}` - the `content` text was
     * nowhere in what reached the model. So where a client is given both, it may show the
     * structured half and drop the prose entirely. Anything the model must read therefore has to
     * be in `structuredContent`, or `structuredContent` must not be sent at all.
     *
     * Worth carrying back into the app's own MCP tools: a tool whose explanation lives only in
     * `content` may be explaining itself to nobody.
     */
    const report = hostReport();
    return {
      // In both halves deliberately: a client given both may surface only the structured one.
      structuredContent: { hostReport: report },
      content: [
        {
          type: "text",
          text:
            "WHAT THIS HOST HAS ACTUALLY DONE (read this out verbatim; it is the diagnostic):\n\n" +
            report +
            "\n\nIf `declares io.modelcontextprotocol/ui` is NO, this host does not render MCP Apps " +
            "and nothing about the view can be concluded. If it is YES but `resources/read` was " +
            "NEVER called, the host advertises the extension but never fetched the view.",
        },
      ],
    };
  },
};

export function createMcpProbeApp() {
  return (
    new Hono()
      // Permissive and harmless: this surface has no data and no authority. A connector is fetched
      // server-side so CORS should not arise, but a browser-side probe of the same endpoint is a
      // useful debugging path and this keeps it open.
      .use("/mcp-probe/*", async (c, next) => {
        c.header("Access-Control-Allow-Origin", "*");
        c.header("Access-Control-Allow-Headers", "*");
        await next();
      })
      .options("/mcp-probe/*", (c) => c.body(null, 204))
      /** The cross-origin AudioWorklet module. Served from here so `resourceDomains` can name it. */
      .get("/mcp-probe/worklet.js", (c) => {
        c.header("Content-Type", "text/javascript; charset=utf-8");
        return c.body(PROBE_WORKLET_SOURCE);
      })
      /** The view's own logic, external so it can run even where inline scripts are forbidden. */
      .get("/mcp-probe/view.js", (c) => {
        const origin = publicOrigin(c.req.url, c.req.header("x-forwarded-host"), c.req.header("x-forwarded-proto"));
        c.header("Content-Type", "text/javascript; charset=utf-8");
        return c.body(probeScriptSource(origin));
      })
      /**
       * The identical page at a plain URL, openable in an ordinary browser tab. The control: if it
       * renders here and not in the host, the page is fine and the host is the variable. Without
       * this, "empty box" cannot be told apart from "my HTML is broken".
       */
      .get("/mcp-probe/view.html", (c) => {
        const origin = publicOrigin(c.req.url, c.req.header("x-forwarded-host"), c.req.header("x-forwarded-proto"));
        c.header("Content-Type", "text/html; charset=utf-8");
        return c.body(probeViewHtml(origin));
      })
      /** The same account as the tool returns, readable without going through a model. */
      .get("/mcp-probe/log", (c) => c.text(hostReport()))
      /** A trivial target for the `connectDomains` fetch probe. */
      .get("/mcp-probe/ping", (c) => c.text("pong"))
      /**
       * **Say "no OAuth here" properly.** A client probes these before connecting, and the honest
       * answer for an unauthenticated server is 404. Without this the SPA catch-all further down
       * answers them with `index.html` and a **200**, so the client is handed a page of HTML where
       * it expected either auth metadata or a refusal - and the resulting failure names nothing.
       *
       * The paths take suffixes (RFC 9728 appends the resource path, e.g.
       * `/.well-known/oauth-protected-resource/mcp`), hence the wildcards.
       */
      .get("/.well-known/oauth-protected-resource/*", (c) => c.json({ error: "not-found" }, 404))
      .get("/.well-known/oauth-protected-resource", (c) => c.json({ error: "not-found" }, 404))
      .get("/.well-known/oauth-authorization-server/*", (c) => c.json({ error: "not-found" }, 404))
      .get("/.well-known/oauth-authorization-server", (c) => c.json({ error: "not-found" }, 404))
      .post("/mcp", async (c) => {
        const origin = publicOrigin(c.req.url, c.req.header("x-forwarded-host"), c.req.header("x-forwarded-proto"));
        const body = (await c.req.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
        if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);

        // A batch is legal JSON-RPC; answer each and drop the notifications' empty slots.
        const requests = Array.isArray(body) ? body : [body];
        const responses = requests.flatMap((request): JsonRpcResponse[] => {
          hostLog.methodCounts[request.method] = (hostLog.methodCounts[request.method] ?? 0) + 1;
          const handler = handlers[request.method];
          // A notification (no id) gets no response whether or not it is understood.
          if (request.id === undefined) return [];
          if (!handler) {
            return [
              {
                jsonrpc: "2.0",
                id: request.id,
                error: { code: -32601, message: `method not found: ${request.method}` },
              },
            ];
          }
          try {
            return [{ jsonrpc: "2.0", id: request.id, result: handler(request.params ?? {}, origin) }];
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return [{ jsonrpc: "2.0", id: request.id, error: { code: -32602, message } }];
          }
        });

        if (responses.length === 0) return c.body(null, 202);
        return c.json(Array.isArray(body) ? responses : responses[0]);
      })
      // The spec allows a server to decline the optional server-initiated SSE stream.
      .get("/mcp", (c) => c.text("this probe is POST-only (no server-initiated stream)", 405))
  );
}
