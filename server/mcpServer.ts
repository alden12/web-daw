/**
 * The Node-hosted MCP server. A control-plane over the project model, never an
 * audio path: tools mirror the same ProjectStore/ParamStore/ClipStore the UI
 * uses, validate against each instrument's schema, and forward edits over a
 * WebSocket to the open DAW tab. Everything is track-addressed; `track` defaults
 * to the selected track when omitted.
 *
 * `createDawMcp` returns the McpServer plus a close fn so it can be driven by a
 * stdio transport in production and an in-memory transport in tests.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { ProjectStore } from '../src/audio/project/projectStore';
import type { Track } from '../src/audio/project/projectStore';
import { INSTRUMENT_CATALOG, instrumentSchema } from '../src/audio/instruments/catalog';
import { validateParam } from '../src/audio/params/validate';
import type { NoteEvent } from '../src/audio/sequencer/types';
import { DEFAULT_WS_PORT } from '../src/audio/mcp/protocol';
import type { BrowserToServer, ServerToBrowser } from '../src/audio/mcp/protocol';

const randomId = () => crypto.randomUUID();
const makeTrackId = () => `t-${randomId().slice(0, 8)}`;

export interface DawMcp {
  server: McpServer;
  close(): Promise<void>;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export function createDawMcp(
  options: { port?: number; onError?: (err: NodeJS.ErrnoException) => void } = {},
): DawMcp {
  const port = options.port ?? DEFAULT_WS_PORT;

  // The server's mirror of the tab's project, kept current by the sync messages.
  const mirror = new ProjectStore(false);

  let tab: WebSocket | null = null;
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });

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
      if (msg.type === 'projectSnapshot' || msg.type === 'projectStructure') mirror.load(msg.project);
      else if (msg.type === 'paramChanged') mirror.getTrack(msg.trackId)?.params.set(msg.id, msg.value);
      else if (msg.type === 'clipSnapshot') mirror.getTrack(msg.trackId)?.clip.load(msg.clip);
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

  /** Resolve a track id (explicit, else selected). */
  function resolveTrack(track?: string): { id: string; track: Track } | { error: string } {
    const id = track ?? mirror.selectedId ?? undefined;
    if (!id) return { error: 'No track specified and no track is selected. Use list_tracks / create_track.' };
    const t = mirror.getTrack(id);
    if (!t) return { error: `Unknown track "${id}". Use list_tracks to see valid ids.` };
    return { id, track: t };
  }

  let sequenceTimers: ReturnType<typeof setTimeout>[] = [];
  const clearSequence = () => {
    for (const t of sequenceTimers) clearTimeout(t);
    sequenceTimers = [];
  };

  const server = new McpServer({ name: 'web-daw', version: '0.1.0' });
  const trackArg = { track: z.string().optional().describe('track id; defaults to the selected track') };

  // --- Tracks ---------------------------------------------------------------
  server.registerTool(
    'list_tracks',
    {
      title: 'List tracks',
      description: 'List all tracks (id, name, instrument, mute, volume, note count), the tempo, and the available instrument types.',
    },
    async () =>
      ok(
        JSON.stringify(
          {
            connected: connected(),
            tempoBpm: mirror.tempo,
            lengthBeats: mirror.length,
            selectedTrackId: mirror.selectedId,
            instruments: Object.entries(INSTRUMENT_CATALOG).map(([id, def]) => ({ id, label: def.label })),
            tracks: mirror.getTracks().map((t) => ({
              id: t.id,
              name: t.name,
              instrument: t.instrumentType,
              muted: t.muted,
              volume: t.volume,
              notes: t.clip.getClip().notes.length,
            })),
          },
          null,
          2,
        ),
      ),
  );

  server.registerTool(
    'create_track',
    {
      title: 'Create track',
      description: 'Create a track with the given instrument type (see list_tracks for ids). Returns the new track id.',
      inputSchema: { instrument: z.string(), name: z.string().optional() },
    },
    async ({ instrument, name }) => {
      if (!(instrument in INSTRUMENT_CATALOG)) {
        return fail(`Unknown instrument "${instrument}". Options: ${Object.keys(INSTRUMENT_CATALOG).join(', ')}.`);
      }
      const id = makeTrackId();
      if (!sendToTab({ type: 'createTrack', instrumentType: instrument, name, id })) {
        return fail('No DAW tab connected.');
      }
      mirror.addTrack(instrument, name, id);
      return ok(`Created ${instrument} track "${mirror.getTrack(id)?.name}" (id ${id}).`);
    },
  );

  server.registerTool(
    'remove_track',
    { title: 'Remove track', description: 'Delete a track and its clip.', inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'removeTrack', trackId: r.id })) return fail('No DAW tab connected.');
      mirror.removeTrack(r.id);
      return ok(`Removed track ${r.id}.`);
    },
  );

  server.registerTool(
    'select_track',
    { title: 'Select track', description: 'Make a track the selected/default track.', inputSchema: { track: z.string() } },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'selectTrack', trackId: r.id })) return fail('No DAW tab connected.');
      mirror.selectTrack(r.id);
      return ok(`Selected track ${r.id}.`);
    },
  );

  server.registerTool(
    'set_track',
    {
      title: 'Set track',
      description: 'Set a track\'s mute, volume (0..1), and/or name.',
      inputSchema: { ...trackArg, muted: z.boolean().optional(), volume: z.number().min(0).max(1).optional(), name: z.string().optional() },
    },
    async ({ track, muted, volume, name }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'setTrack', trackId: r.id, muted, volume, name })) return fail('No DAW tab connected.');
      if (muted !== undefined) mirror.setMuted(r.id, muted);
      if (volume !== undefined) mirror.setVolume(r.id, volume);
      if (name !== undefined) mirror.renameTrack(r.id, name);
      return ok(`Updated track ${r.id}.`);
    },
  );

  // --- Parameters -----------------------------------------------------------
  server.registerTool(
    'list_parameters',
    { title: 'List parameters', description: 'List a track instrument\'s parameters with schema and current values.', inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      const params = instrumentSchema(r.track.instrumentType).map((spec) => ({ ...spec, value: r.track.params.get(spec.id) }));
      return ok(JSON.stringify({ track: r.id, instrument: r.track.instrumentType, parameters: params }, null, 2));
    },
  );

  server.registerTool(
    'set_parameter',
    {
      title: 'Set parameter',
      description: 'Set an instrument parameter on a track. Validated against the schema (range/enum).',
      inputSchema: { ...trackArg, id: z.string(), value: z.union([z.number(), z.string(), z.boolean()]) },
    },
    async ({ track, id, value }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      let spec;
      try {
        spec = r.track.params.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}" for instrument "${r.track.instrumentType}".`);
      }
      const err = validateParam(spec, value);
      if (err) return fail(err);
      if (!sendToTab({ type: 'setParam', trackId: r.id, id, value })) return fail('No DAW tab connected.');
      r.track.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on ${r.id}.`);
    },
  );

  // --- Clip notes -----------------------------------------------------------
  const noteShape = {
    pitch: z.number().int().min(0).max(127),
    start: z.number().min(0).describe('onset in beats (4 beats = 1 bar)'),
    length: z.number().min(0).optional().describe('duration in beats (default 1)'),
    velocity: z.number().min(0).max(1).optional(),
  };
  const makeNote = (n: { pitch: number; start: number; length?: number; velocity?: number }): NoteEvent => ({
    id: randomId(),
    pitch: n.pitch,
    start: n.start,
    length: n.length ?? 1,
    velocity: n.velocity ?? 0.8,
  });

  server.registerTool(
    'list_notes',
    { title: 'List notes', description: 'Return a track\'s clip notes (id, pitch, start/length in beats, velocity).', inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      return ok(JSON.stringify({ track: r.id, clip: r.track.clip.getClip() }, null, 2));
    },
  );

  server.registerTool(
    'add_note',
    { title: 'Add note', description: 'Add one note to a track\'s clip. Times in beats. Returns the note id.', inputSchema: { ...trackArg, ...noteShape } },
    async ({ track, pitch, start, length, velocity }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      const note = makeNote({ pitch, start, length, velocity });
      if (!sendToTab({ type: 'addNote', trackId: r.id, note })) return fail('No DAW tab connected.');
      r.track.clip.putNote(note);
      return ok(`Added note ${pitch} at beat ${start} to ${r.id} (id ${note.id}).`);
    },
  );

  server.registerTool(
    'add_notes',
    {
      title: 'Add notes',
      description: 'Add many notes to a track\'s clip at once (write a whole part). Times in beats.',
      inputSchema: { ...trackArg, notes: z.array(z.object(noteShape)).min(1).max(512) },
    },
    async ({ track, notes }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!connected()) return fail('No DAW tab connected.');
      for (const input of notes) {
        const note = makeNote(input);
        sendToTab({ type: 'addNote', trackId: r.id, note });
        r.track.clip.putNote(note);
      }
      return ok(`Added ${notes.length} notes to ${r.id}.`);
    },
  );

  server.registerTool(
    'remove_note',
    { title: 'Remove note', description: 'Remove a note from a track\'s clip by id.', inputSchema: { ...trackArg, id: z.string() } },
    async ({ track, id }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'removeNote', trackId: r.id, id })) return fail('No DAW tab connected.');
      r.track.clip.removeNote(id);
      return ok(`Removed note ${id} from ${r.id}.`);
    },
  );

  server.registerTool(
    'clear_clip',
    { title: 'Clear clip', description: 'Remove all notes from a track\'s clip.', inputSchema: trackArg },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'clearClip', trackId: r.id })) return fail('No DAW tab connected.');
      r.track.clip.clear();
      return ok(`Cleared clip on ${r.id}.`);
    },
  );

  // --- Transport (project-level) -------------------------------------------
  server.registerTool(
    'set_tempo',
    { title: 'Set tempo', description: 'Set the project tempo in BPM (20-300).', inputSchema: { bpm: z.number().min(20).max(300) } },
    async ({ bpm }) => {
      if (!sendToTab({ type: 'setTempo', bpm })) return fail('No DAW tab connected.');
      mirror.setTempo(bpm);
      return ok(`Tempo set to ${bpm} BPM.`);
    },
  );

  server.registerTool('play', { title: 'Play', description: 'Start playback (loops all tracks).' }, async () =>
    sendToTab({ type: 'transport', action: 'play' }) ? ok('Playing.') : fail('No DAW tab connected.'),
  );
  server.registerTool('stop', { title: 'Stop', description: 'Stop playback.' }, async () =>
    sendToTab({ type: 'transport', action: 'stop' }) ? ok('Stopped.') : fail('No DAW tab connected.'),
  );

  // --- Live notes -----------------------------------------------------------
  server.registerTool(
    'note_on',
    { title: 'Note on', description: 'Start a held note on a track (MIDI 0-127, 60 = middle C).', inputSchema: { ...trackArg, midi: z.number().int().min(0).max(127), velocity: z.number().min(0).max(1).optional() } },
    async ({ track, midi, velocity }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      return sendToTab({ type: 'noteOn', trackId: r.id, midi, velocity }) ? ok(`noteOn ${midi} on ${r.id}`) : fail('No DAW tab connected.');
    },
  );

  server.registerTool(
    'note_off',
    { title: 'Note off', description: 'Release a note on a track by its MIDI number.', inputSchema: { ...trackArg, midi: z.number().int().min(0).max(127) } },
    async ({ track, midi }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      return sendToTab({ type: 'noteOff', trackId: r.id, midi }) ? ok(`noteOff ${midi} on ${r.id}`) : fail('No DAW tab connected.');
    },
  );

  server.registerTool(
    'play_note',
    { title: 'Play note', description: 'Play a note on a track for a duration (ms, default 500).', inputSchema: { ...trackArg, midi: z.number().int().min(0).max(127), durationMs: z.number().min(1).max(20000).optional(), velocity: z.number().min(0).max(1).optional() } },
    async ({ track, midi, durationMs, velocity }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'noteOn', trackId: r.id, midi, velocity })) return fail('No DAW tab connected.');
      const dur = durationMs ?? 500;
      setTimeout(() => sendToTab({ type: 'noteOff', trackId: r.id, midi }), dur);
      return ok(`Played ${midi} for ${dur}ms on ${r.id}.`);
    },
  );

  server.registerTool(
    'play_sequence',
    {
      title: 'Play sequence',
      description: 'Play a monophonic melody on a track ad-hoc (not saved to the clip). For songs to keep, use add_notes + play.',
      inputSchema: {
        ...trackArg,
        notes: z.array(z.object({ midi: z.number().int().min(0).max(127), durationMs: z.number().min(1).max(20000) })).min(1).max(512),
        articulationMs: z.number().min(0).max(500).optional(),
      },
    },
    async ({ track, notes, articulationMs }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!connected()) return fail('No DAW tab connected.');
      clearSequence();
      const gap = articulationMs ?? 30;
      let t = 0;
      for (const { midi, durationMs } of notes) {
        const start = t;
        sequenceTimers.push(setTimeout(() => sendToTab({ type: 'noteOn', trackId: r.id, midi }), start));
        sequenceTimers.push(setTimeout(() => sendToTab({ type: 'noteOff', trackId: r.id, midi }), start + Math.max(1, durationMs - gap)));
        t += durationMs;
      }
      return ok(`Playing ${notes.length} notes over ${t}ms on ${r.id}.`);
    },
  );

  const close = async () => {
    clearSequence();
    for (const client of wss.clients) client.terminate();
    tab = null;
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await server.close().catch(() => undefined);
  };

  return { server, close };
}
