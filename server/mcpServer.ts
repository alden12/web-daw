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
import type { Track, EffectInstance } from '../src/audio/project/projectStore';
import { INSTRUMENT_CATALOG, instrumentSchema } from '../src/audio/instruments/catalog';
import { EFFECT_CATALOG, effectSchema } from '../src/audio/effects/catalog';
import { validateParam } from '../src/audio/params/validate';
import type { NoteEvent } from '../src/audio/sequencer/types';
import { DEFAULT_WS_PORT } from '../src/audio/mcp/protocol';
import type { BrowserToServer, ServerToBrowser } from '../src/audio/mcp/protocol';

const randomId = () => crypto.randomUUID();
const makeTrackId = () => `t-${randomId().slice(0, 8)}`;
const makeEffectId = () => `fx-${randomId().slice(0, 8)}`;

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

  // One handler per inbound sync message (map dispatch, not if/else). Mapped type
  // makes leaving a message type unhandled a compile error.
  type Inbound = { [K in BrowserToServer['type']]: (msg: Extract<BrowserToServer, { type: K }>) => void };
  const inbound: Inbound = {
    projectSnapshot: (msg) => mirror.load(msg.project),
    projectStructure: (msg) => mirror.load(msg.project),
    paramChanged: (msg) => mirror.getTrack(msg.trackId)?.params.set(msg.id, msg.value),
    clipSnapshot: (msg) => mirror.getTrack(msg.trackId)?.clip.load(msg.clip),
    effectParamChanged: (msg) => mirror.getEffect(msg.trackId, msg.effectId)?.params.set(msg.id, msg.value),
  };

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
      (inbound[msg.type] as (m: BrowserToServer) => void)?.(msg);
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

  /** Resolve a track (explicit/selected) and one of its effects by id. */
  function resolveEffect(
    track: string | undefined,
    effectId: string,
  ): { trackId: string; track: Track; effect: EffectInstance } | { error: string } {
    const r = resolveTrack(track);
    if ('error' in r) return { error: r.error };
    const effect = r.track.effects.find((fx) => fx.id === effectId);
    if (!effect) return { error: `Unknown effect "${effectId}" on track ${r.id}. Use list_effects.` };
    return { trackId: r.id, track: r.track, effect };
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

  // --- Effects --------------------------------------------------------------
  server.registerTool(
    'list_effects',
    {
      title: 'List effects',
      description: 'List a track\'s effect chain (id, type, bypass, in order) and the available effect types.',
      inputSchema: trackArg,
    },
    async ({ track }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      return ok(
        JSON.stringify(
          {
            track: r.id,
            available: Object.entries(EFFECT_CATALOG).map(([id, def]) => ({ id, label: def.label })),
            effects: r.track.effects.map((fx) => ({ id: fx.id, type: fx.type, bypassed: fx.bypassed })),
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    'add_effect',
    {
      title: 'Add effect',
      description: 'Append an effect to a track\'s chain (see list_effects for types). Returns the new effect id.',
      inputSchema: { ...trackArg, effect: z.string() },
    },
    async ({ track, effect }) => {
      const r = resolveTrack(track);
      if ('error' in r) return fail(r.error);
      if (!(effect in EFFECT_CATALOG)) {
        return fail(`Unknown effect "${effect}". Options: ${Object.keys(EFFECT_CATALOG).join(', ')}.`);
      }
      const id = makeEffectId();
      if (!sendToTab({ type: 'addEffect', trackId: r.id, effectType: effect, id })) return fail('No DAW tab connected.');
      mirror.addEffect(r.id, effect, id);
      return ok(`Added ${effect} effect to ${r.id} (id ${id}).`);
    },
  );

  server.registerTool(
    'remove_effect',
    {
      title: 'Remove effect',
      description: 'Remove an effect from a track\'s chain by id.',
      inputSchema: { ...trackArg, effect_id: z.string() },
    },
    async ({ track, effect_id }) => {
      const r = resolveEffect(track, effect_id);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'removeEffect', trackId: r.trackId, effectId: effect_id })) return fail('No DAW tab connected.');
      mirror.removeEffect(r.trackId, effect_id);
      return ok(`Removed effect ${effect_id} from ${r.trackId}.`);
    },
  );

  server.registerTool(
    'move_effect',
    {
      title: 'Move effect',
      description: 'Reorder an effect within a track\'s chain (0 = first/earliest in the signal path).',
      inputSchema: { ...trackArg, effect_id: z.string(), to_index: z.number().int().min(0) },
    },
    async ({ track, effect_id, to_index }) => {
      const r = resolveEffect(track, effect_id);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'moveEffect', trackId: r.trackId, effectId: effect_id, toIndex: to_index })) return fail('No DAW tab connected.');
      mirror.moveEffect(r.trackId, effect_id, to_index);
      return ok(`Moved effect ${effect_id} to index ${to_index} on ${r.trackId}.`);
    },
  );

  server.registerTool(
    'bypass_effect',
    {
      title: 'Bypass effect',
      description: 'Enable or bypass an effect (bypassed effects are skipped in the signal path).',
      inputSchema: { ...trackArg, effect_id: z.string(), bypassed: z.boolean() },
    },
    async ({ track, effect_id, bypassed }) => {
      const r = resolveEffect(track, effect_id);
      if ('error' in r) return fail(r.error);
      if (!sendToTab({ type: 'bypassEffect', trackId: r.trackId, effectId: effect_id, bypassed })) return fail('No DAW tab connected.');
      mirror.setEffectBypass(r.trackId, effect_id, bypassed);
      return ok(`${bypassed ? 'Bypassed' : 'Enabled'} effect ${effect_id} on ${r.trackId}.`);
    },
  );

  server.registerTool(
    'list_effect_parameters',
    {
      title: 'List effect parameters',
      description: 'List an effect\'s parameters with schema and current values.',
      inputSchema: { ...trackArg, effect_id: z.string() },
    },
    async ({ track, effect_id }) => {
      const r = resolveEffect(track, effect_id);
      if ('error' in r) return fail(r.error);
      const params = effectSchema(r.effect.type).map((spec) => ({ ...spec, value: r.effect.params.get(spec.id) }));
      return ok(JSON.stringify({ track: r.trackId, effect: effect_id, type: r.effect.type, parameters: params }, null, 2));
    },
  );

  server.registerTool(
    'set_effect_parameter',
    {
      title: 'Set effect parameter',
      description: 'Set a parameter on an effect. Validated against the effect\'s schema (range/enum).',
      inputSchema: { ...trackArg, effect_id: z.string(), id: z.string(), value: z.union([z.number(), z.string(), z.boolean()]) },
    },
    async ({ track, effect_id, id, value }) => {
      const r = resolveEffect(track, effect_id);
      if ('error' in r) return fail(r.error);
      let spec;
      try {
        spec = r.effect.params.spec(id);
      } catch {
        return fail(`Unknown parameter "${id}" for effect "${r.effect.type}".`);
      }
      const err = validateParam(spec, value);
      if (err) return fail(err);
      if (!sendToTab({ type: 'setEffectParam', trackId: r.trackId, effectId: effect_id, id, value })) return fail('No DAW tab connected.');
      r.effect.params.set(id, value);
      return ok(`Set ${id} = ${JSON.stringify(value)} on effect ${effect_id}.`);
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
