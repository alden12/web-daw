/**
 * MCP server entry point. Claude Code spawns this over stdio (see .mcp.json);
 * it also opens a WebSocket the DAW tab connects to. Anything written to stdout
 * would corrupt the stdio MCP channel, so logs go to stderr.
 *
 * Lifecycle matters here: the WebSocket server keeps Node's event loop alive, so
 * we must exit when the stdio connection closes (or on a signal). Otherwise the
 * process lingers holding the WS port and the next spawn fails with EADDRINUSE.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDawMcp } from "./mcpServer";
import { DEFAULT_WS_PORT } from "../src/audio/mcp/protocol";

const port = process.env.WEBDAW_WS_PORT ? Number(process.env.WEBDAW_WS_PORT) : DEFAULT_WS_PORT;

const { server, close } = createDawMcp({
  port,
  onError: (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[web-daw] Port ${port} is already in use - another server instance is running. Exiting.`);
      process.exit(1);
    }
  },
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Hard backstop: never let a wedged close() keep the process (and the WS port)
  // alive after the client has gone.
  const hard = setTimeout(() => process.exit(0), 1500);
  hard.unref();
  void close().finally(() => process.exit(0));
};

// Exit when Claude Code closes the stdio connection or signals us, so we release
// the WebSocket port instead of becoming an orphan. StdioServerTransport only
// watches stdin 'data'/'error', not EOF, so we watch stdin end/close ourselves
// (the WebSocket server would otherwise keep the event loop alive forever).
server.server.onclose = shutdown;
process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
console.error(`[web-daw] MCP server ready; DAW WebSocket on ws://localhost:${port}`);
