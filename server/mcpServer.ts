/**
 * The Node-hosted MCP server. It is a control-plane over the synth's parameter
 * model, never an audio path: tools are projected from the same `synthSchema`
 * the UI uses, and writes are forwarded over a WebSocket to the open DAW tab,
 * which applies them through the shared `ParamStore`.
 *
 * `createDawMcp` returns the McpServer plus a close fn so it can be driven by a
 * stdio transport in production and an in-memory transport in tests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { ParamStore } from '../src/audio/params/store';
import { synthSchema } from '../src/audio/synth/schema';
import type { ParamSpec, ParamValue } from '../src/audio/params/types';
import { DEFAULT_WS_PORT } from '../src/audio/mcp/protocol';
import type { BrowserToServer, ServerToBrowser } from '../src/audio/mcp/protocol';

export interface DawMcp {
  server: McpServer;
  close(): Promise<void>;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

function validate(spec: ParamSpec, value: ParamValue): string | null {
  switch (spec.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `"${spec.id}" expects a number.`;
      if (value < spec.min || value > spec.max) {
        const unit = spec.unit ? ` ${spec.unit}` : '';
        return `"${spec.id}" out of range: must be ${spec.min}..${spec.max}${unit}.`;
      }
      return null;
    case 'enum':
      return spec.options.includes(value as string)
        ? null
        : `"${spec.id}" must be one of: ${spec.options.join(', ')}.`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${spec.id}" expects a boolean.`;
  }
}

export function createDawMcp(
  options: { port?: number; onError?: (err: NodeJS.ErrnoException) => void } = {},
): DawMcp {
  const port = options.port ?? DEFAULT_WS_PORT;

  // The server's mirror of the tab's state, kept current by snapshot/paramChanged.
  const mirror = new ParamStore(synthSchema);

  // A single connected DAW tab (localhost, single-tab assumption).
  let tab: WebSocket | null = null;
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });

  // Without a handler, a bind failure (e.g. EADDRINUSE) is an unhandled 'error'
  // event that crashes the whole MCP process. Surface it instead.
  wss.on('error', (err: NodeJS.ErrnoException) => {
    console.error(`[web-daw] WebSocket server error: ${err.message}`);
    options.onError?.(err);
  });

  wss.on('connection', (socket) => {
    tab = socket;
    socket.on('message', (raw: RawData) => {
      let msg: BrowserToServer;
      try {
        msg = JSON.parse(raw.toString()) as BrowserToServer;
      } catch {
        return;
      }
      if (msg.type === 'snapshot') mirror.load(msg.values);
      else if (msg.type === 'paramChanged') mirror.set(msg.id, msg.value);
    });
    socket.on('close', () => {
      if (tab === socket) tab = null;
    });
  });

  const connected = () => tab !== null && tab.readyState === WebSocket.OPEN;
  const sendToTab = (msg: ServerToBrowser): boolean => {
    if (!connected()) return false;
    tab!.send(JSON.stringify(msg));
    return true;
  };

  const server = new McpServer({ name: 'web-daw', version: '0.1.0' });

  server.registerTool(
    'list_parameters',
    {
      title: 'List parameters',
      description:
        'List every synth parameter with its schema and current value, plus whether a DAW tab is connected.',
    },
    async () => {
      const parameters = synthSchema.map((spec) => ({ ...spec, value: mirror.get(spec.id) }));
      return ok(JSON.stringify({ connected: connected(), parameters }, null, 2));
    },
  );

  server.registerTool(
    'get_parameter',
    {
      title: 'Get parameter',
      description: 'Get the current value (and schema) of one parameter by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const spec = mirror.spec(id);
        return ok(JSON.stringify({ id, value: mirror.get(id), spec }));
      } catch {
        return fail(`Unknown parameter "${id}". Call list_parameters for valid ids.`);
      }
    },
  );

  server.registerTool(
    'set_parameter',
    {
      title: 'Set parameter',
      description:
        'Set a parameter by id. Validated against the schema (range/enum), then applied in the DAW tab through the shared parameter store.',
      inputSchema: { id: z.string(), value: z.union([z.number(), z.string(), z.boolean()]) },
    },
    async ({ id, value }) => {
      let spec: ParamSpec;
      try {
        spec = mirror.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}". Call list_parameters for valid ids.`);
      }
      const error = validate(spec, value);
      if (error) return fail(error);
      if (!sendToTab({ type: 'setParam', id, value })) {
        return fail('No DAW tab connected. Open the app (npm run dev) in a browser first.');
      }
      mirror.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)}`);
    },
  );

  server.registerTool(
    'note_on',
    {
      title: 'Note on',
      description: 'Start a note and hold it. MIDI note number 0-127 (60 = middle C).',
      inputSchema: { midi: z.number().int().min(0).max(127) },
    },
    async ({ midi }) => (sendToTab({ type: 'noteOn', midi }) ? ok(`noteOn ${midi}`) : fail('No DAW tab connected.')),
  );

  server.registerTool(
    'note_off',
    { title: 'Note off', description: 'Release the currently sounding note.' },
    async () => (sendToTab({ type: 'noteOff' }) ? ok('noteOff') : fail('No DAW tab connected.')),
  );

  server.registerTool(
    'play_note',
    {
      title: 'Play note',
      description: 'Play a note for a fixed duration. MIDI note number 0-127; durationMs defaults to 500.',
      inputSchema: {
        midi: z.number().int().min(0).max(127),
        durationMs: z.number().min(1).max(20000).optional(),
      },
    },
    async ({ midi, durationMs }) => {
      if (!sendToTab({ type: 'noteOn', midi })) return fail('No DAW tab connected.');
      const dur = durationMs ?? 500;
      setTimeout(() => sendToTab({ type: 'noteOff' }), dur);
      return ok(`Played ${midi} for ${dur}ms`);
    },
  );

  const close = async () => {
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close();
  };

  return { server, close };
}
