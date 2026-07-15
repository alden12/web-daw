/**
 * The AI agent's key-proxy: a tiny dev-server endpoint that holds the model API key
 * server-side and forwards chat-completions requests to an OpenAI-compatible provider
 * (Gemini by default). The browser never sees the key - it POSTs to `/api/agent/chat`
 * and this middleware injects the Authorization header and the model, then relays the
 * reply. Provider-agnostic on purpose: base URL, model, and key are env, so swapping
 * Gemini for OpenAI / Groq / a local Ollama is a `.env` change, not code. See
 * docs/AGENT.md (phase 1) and invariant 6 (secrets stay server-side).
 *
 * Deliberately thin: it validates the request is well-formed, forwards it, relays the
 * response. It is a Vite dev middleware today; a real deployment needs an endpoint with
 * auth + rate limiting (a follow-on).
 */
import type { Plugin } from "vite";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { AGENT_CHAT_PATH } from "../src/audio/agent/types";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-2.5-flash";

/** Resolved server-side config for the proxy (from env; never reaches the client). */
export interface AgentProxyConfig {
  apiKey: string;
  /** OpenAI-compatible base, e.g. Gemini's `.../v1beta/openai`. No trailing slash. */
  baseUrl: string;
  model: string;
}

/** Read the proxy config from an env bag (Vite's `loadEnv` output or `process.env`). */
export function agentProxyConfig(env: Record<string, string | undefined>): AgentProxyConfig {
  return {
    apiKey: env.AGENT_API_KEY ?? "",
    baseUrl: (env.AGENT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.AGENT_MODEL ?? DEFAULT_MODEL,
  };
}

/** An error carrying the HTTP status to relay to the browser. */
export class AgentProxyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentProxyError";
    this.status = status;
  }
}

// The browser sends an OpenAI-shaped chat request; the proxy owns the model. Validated
// loosely - we reject obvious garbage but forward the original body (thin proxy), so we
// never couple to the full, evolving OpenAI/Gemini message schema.
const chatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.string() })).min(1),
  temperature: z.number().optional(),
});

export interface UpstreamRequest {
  url: string;
  init: RequestInit;
}

/**
 * Pure: validate the incoming body + config and build the upstream fetch. Throws an
 * `AgentProxyError` (with the status to relay) on a missing key or a malformed body.
 * Separate from the middleware so it is unit-testable without a running server.
 */
export function buildUpstreamRequest(body: unknown, config: AgentProxyConfig): UpstreamRequest {
  if (!config.apiKey) {
    throw new AgentProxyError(
      503,
      "AGENT_API_KEY is not set. Add it to .env (see .env.example) and restart the dev server.",
    );
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AgentProxyError(
      400,
      `Malformed agent request: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      // Forward the original body (not the zod output, which strips unknown keys like
      // `tools`), with the server-owned model merged in. Non-streaming for now.
      body: JSON.stringify({ ...(body as object), model: config.model, stream: false }),
    },
  };
}

/** Collect a request stream into parsed JSON (or throw a 400 on invalid JSON). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AgentProxyError(400, "Request body is not valid JSON.");
  }
}

/** The Vite dev-server plugin: mounts the key-proxy middleware at `AGENT_CHAT_PATH`. */
export function agentProxyPlugin(config: AgentProxyConfig): Plugin {
  return {
    name: "web-daw:agent-proxy",
    configureServer(server) {
      server.middlewares.use(AGENT_CHAT_PATH, (req, res) => {
        const fail = (status: number, message: string) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: message }));
        };
        if (req.method !== "POST") return fail(405, "Use POST.");
        void (async () => {
          try {
            const upstream = buildUpstreamRequest(await readJsonBody(req), config);
            const response = await fetch(upstream.url, upstream.init);
            const text = await response.text();
            res.statusCode = response.status;
            res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
            res.end(text);
          } catch (err) {
            if (err instanceof AgentProxyError) return fail(err.status, err.message);
            return fail(502, err instanceof Error ? err.message : "Agent proxy request failed.");
          }
        })();
      });
    },
  };
}
