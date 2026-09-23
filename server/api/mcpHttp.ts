/**
 * `/mcp`: the hosted MCP server over Streamable HTTP (AGENT-28), so Claude can edit a stored project
 * from anywhere - the phone app, claude.ai - rather than only from a machine running the local server.
 *
 * Stateless, like ai-project-manager's: a fresh server and transport per request, no session kept, so
 * any request can land on any instance. Identity comes through the same principal resolver as the
 * rest of the API (a verified JWT, or the dev stub locally), and every project it opens is authorised
 * through the room registry exactly as a WebSocket subscribe is.
 */
import type { Context } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Db } from "../db/types";
import type { RoomRegistry } from "./rooms";
import type { ResolvePrincipal } from "./principal";
import { createHostedMcp } from "../mcp/hosted";

export interface HostedMcpRoute {
  db: Db;
  registry: RoomRegistry;
  resolvePrincipal: ResolvePrincipal;
}

const bearer = (header: string | undefined): string | undefined =>
  header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

export const hostedMcpHandler =
  ({ db, registry, resolvePrincipal }: HostedMcpRoute) =>
  async (c: Context): Promise<Response> => {
    const principal = await resolvePrincipal(bearer(c.req.header("Authorization")));
    if (!principal) {
      c.header("WWW-Authenticate", 'Bearer realm="corrente"');
      return c.json({ error: "unauthorized" }, 401);
    }
    const server = createHostedMcp({ db, registry, principal });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  };
