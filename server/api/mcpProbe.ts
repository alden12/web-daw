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
import { PROBE_WORKLET_SOURCE, probeViewHtml } from "./mcpProbeView";

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

const viewResource = (origin: string) => ({
  uri: VIEW_URI,
  name: "Sandbox probe",
  description: "Reports what this host's sandbox permits.",
  mimeType: UI_MIME,
  _meta: {
    ui: {
      /**
       * The whole point of the exercise. The spec's default CSP is `script-src 'self'
       * 'unsafe-inline'`, which excludes `blob:` - and worklet modules are governed by
       * `script-src`. Declaring this origin should let the view load its AudioWorklet
       * cross-origin instead, and `connectDomains` should let it `fetch` here at all.
       */
      csp: { connectDomains: [origin], resourceDomains: [origin] },
      prefersBorder: true,
    },
  },
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
  _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
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
  _meta: { ui: { visibility: ["app"] } },
};

/** Method -> result. Notifications return undefined, which is answered with 202 and no body. */
const handlers: Record<string, (params: Record<string, unknown>, origin: string) => unknown> = {
  initialize: (params) => ({
    protocolVersion: (params?.protocolVersion as string) ?? FALLBACK_PROTOCOL,
    capabilities: {
      tools: {},
      resources: {},
      extensions: { [UI_EXTENSION]: { mimeTypes: [UI_MIME] } },
    },
    serverInfo: { name: "webdaw-sandbox-probe", version: "1.0.0" },
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: [probeTool, reportTool] }),
  "resources/list": (_params, origin) => ({ resources: [viewResource(origin)] }),
  "resources/read": (params, origin) => {
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
    return {
      content: [
        {
          type: "text",
          text:
            "Sandbox probe rendered. It reports its own findings by calling `report_probe_results`, " +
            "so wait for that before summarising. If it never arrives, that is itself the finding: " +
            "the view cannot reach the model, and there are no agent ears in this host.",
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
