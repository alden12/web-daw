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
import { ClipStore } from '../src/audio/sequencer/clipStore';
import type { NoteEvent } from '../src/audio/sequencer/types';
import { DEFAULT_WS_PORT } from '../src/audio/mcp/protocol';
import type { BrowserToServer, ServerToBrowser } from '../src/audio/mcp/protocol';

function randomId(): string {
  return crypto.randomUUID();
}

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
  const clipMirror = new ClipStore();

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
      else if (msg.type === 'clipSnapshot') clipMirror.load(msg.clip);
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

  // Pending note events for an in-flight play_sequence; cleared if a new
  // sequence starts or the server shuts down, so notes never outlive their run.
  let sequenceTimers: ReturnType<typeof setTimeout>[] = [];
  const clearSequence = () => {
    for (const t of sequenceTimers) clearTimeout(t);
    sequenceTimers = [];
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
      description: 'Start a note and hold it. MIDI note number 0-127 (60 = middle C). Polyphonic.',
      inputSchema: {
        midi: z.number().int().min(0).max(127),
        velocity: z.number().min(0).max(1).optional(),
      },
    },
    async ({ midi, velocity }) =>
      sendToTab({ type: 'noteOn', midi, velocity }) ? ok(`noteOn ${midi}`) : fail('No DAW tab connected.'),
  );

  server.registerTool(
    'note_off',
    {
      title: 'Note off',
      description: 'Release a sounding note by its MIDI number.',
      inputSchema: { midi: z.number().int().min(0).max(127) },
    },
    async ({ midi }) =>
      sendToTab({ type: 'noteOff', midi }) ? ok(`noteOff ${midi}`) : fail('No DAW tab connected.'),
  );

  server.registerTool(
    'play_note',
    {
      title: 'Play note',
      description: 'Play a note for a fixed duration. MIDI note number 0-127; durationMs defaults to 500.',
      inputSchema: {
        midi: z.number().int().min(0).max(127),
        durationMs: z.number().min(1).max(20000).optional(),
        velocity: z.number().min(0).max(1).optional(),
      },
    },
    async ({ midi, durationMs, velocity }) => {
      if (!sendToTab({ type: 'noteOn', midi, velocity })) return fail('No DAW tab connected.');
      const dur = durationMs ?? 500;
      setTimeout(() => sendToTab({ type: 'noteOff', midi }), dur);
      return ok(`Played ${midi} for ${dur}ms`);
    },
  );

  server.registerTool(
    'play_sequence',
    {
      title: 'Play sequence',
      description:
        'Play a monophonic melody ad-hoc (not added to the clip): notes play back-to-back, each for ' +
        'its own durationMs. A short gap (articulationMs, default 30) separates repeats. For songs you ' +
        'want to keep/edit, use add_notes + play instead.',
      inputSchema: {
        notes: z
          .array(
            z.object({
              midi: z.number().int().min(0).max(127),
              durationMs: z.number().min(1).max(20000),
            }),
          )
          .min(1)
          .max(512),
        articulationMs: z.number().min(0).max(500).optional(),
      },
    },
    async ({ notes, articulationMs }) => {
      if (!connected()) return fail('No DAW tab connected.');
      clearSequence();
      const gap = articulationMs ?? 30;
      let t = 0;
      for (const { midi, durationMs } of notes) {
        const start = t;
        sequenceTimers.push(setTimeout(() => sendToTab({ type: 'noteOn', midi }), start));
        sequenceTimers.push(
          setTimeout(() => sendToTab({ type: 'noteOff', midi }), start + Math.max(1, durationMs - gap)),
        );
        t += durationMs;
      }
      return ok(`Playing ${notes.length} notes over ${t}ms`);
    },
  );

  // --- Clip (piano roll) tools ------------------------------------------------

  const noteShape = {
    pitch: z.number().int().min(0).max(127),
    start: z.number().min(0).describe('onset in beats'),
    length: z.number().min(0).optional().describe('duration in beats (default 1)'),
    velocity: z.number().min(0).max(1).optional(),
  };

  const makeNote = (n: {
    pitch: number;
    start: number;
    length?: number;
    velocity?: number;
  }): NoteEvent => ({
    id: randomId(),
    pitch: n.pitch,
    start: n.start,
    length: n.length ?? 1,
    velocity: n.velocity ?? 0.8,
  });

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description: 'Return the current clip: notes (id, pitch, start/length in beats, velocity), tempo, and length.',
    },
    async () => ok(JSON.stringify({ connected: connected(), clip: clipMirror.getClip() }, null, 2)),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add note',
      description: 'Add one note to the clip. Times are in beats (4 beats = 1 bar). Returns the note id.',
      inputSchema: noteShape,
    },
    async (input) => {
      const note = makeNote(input);
      if (!sendToTab({ type: 'addNote', note })) return fail('No DAW tab connected.');
      clipMirror.putNote(note);
      return ok(`Added note ${note.pitch} at beat ${note.start} (id ${note.id})`);
    },
  );

  server.registerTool(
    'add_notes',
    {
      title: 'Add notes',
      description: 'Add many notes to the clip at once (for writing a whole melody). Times in beats.',
      inputSchema: { notes: z.array(z.object(noteShape)).min(1).max(512) },
    },
    async ({ notes }) => {
      if (!connected()) return fail('No DAW tab connected.');
      const ids: string[] = [];
      for (const input of notes) {
        const note = makeNote(input);
        sendToTab({ type: 'addNote', note });
        clipMirror.putNote(note);
        ids.push(note.id);
      }
      return ok(`Added ${ids.length} notes.`);
    },
  );

  server.registerTool(
    'remove_note',
    {
      title: 'Remove note',
      description: 'Remove a note from the clip by id.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      if (!sendToTab({ type: 'removeNote', id })) return fail('No DAW tab connected.');
      clipMirror.removeNote(id);
      return ok(`Removed note ${id}`);
    },
  );

  server.registerTool(
    'clear_clip',
    { title: 'Clear clip', description: 'Remove all notes from the clip.' },
    async () => {
      if (!sendToTab({ type: 'clearClip' })) return fail('No DAW tab connected.');
      clipMirror.clear();
      return ok('Cleared clip.');
    },
  );

  server.registerTool(
    'set_tempo',
    {
      title: 'Set tempo',
      description: 'Set the playback tempo in BPM (20-300).',
      inputSchema: { bpm: z.number().min(20).max(300) },
    },
    async ({ bpm }) => {
      if (!sendToTab({ type: 'setTempo', bpm })) return fail('No DAW tab connected.');
      clipMirror.setTempo(bpm);
      return ok(`Tempo set to ${bpm} BPM.`);
    },
  );

  server.registerTool(
    'play',
    { title: 'Play', description: 'Start clip playback (loops).' },
    async () => (sendToTab({ type: 'transport', action: 'play' }) ? ok('Playing.') : fail('No DAW tab connected.')),
  );

  server.registerTool(
    'stop',
    { title: 'Stop', description: 'Stop clip playback.' },
    async () => (sendToTab({ type: 'transport', action: 'stop' }) ? ok('Stopped.') : fail('No DAW tab connected.')),
  );

  const close = async () => {
    clearSequence();
    // Terminate clients first: wss.close() does not drop existing connections and
    // its callback would otherwise wait on them forever, hanging shutdown.
    for (const client of wss.clients) client.terminate();
    tab = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close().catch(() => undefined);
  };

  return { server, close };
}
