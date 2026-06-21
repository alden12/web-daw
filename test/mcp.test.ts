import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { WebSocket } from 'ws';
import { createDawMcp, type DawMcp } from '../server/mcpServer';

const PORT = 8799;
const URL = `ws://localhost:${PORT}`;

type TextResult = { isError?: boolean; content: { type: string; text: string }[] };

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('MCP server', () => {
  let daw: DawMcp;
  let client: Client;
  let tab: WebSocket | null = null;

  async function call(name: string, args: Record<string, unknown> = {}): Promise<TextResult> {
    return (await client.callTool({ name, arguments: args })) as TextResult;
  }

  /** Connect a fake browser tab and collect the messages it receives. */
  async function connectTab(): Promise<unknown[]> {
    const messages: unknown[] = [];
    const socket = new WebSocket(URL);
    tab = socket;
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    // Wait until the server has registered the connection (reported by list_parameters).
    const start = Date.now();
    for (;;) {
      const res = await call('list_parameters');
      if (JSON.parse(res.content[0].text).connected === true) break;
      if (Date.now() - start > 1000) throw new Error('tab was not registered in time');
      await new Promise((r) => setTimeout(r, 10));
    }
    return messages;
  }

  beforeEach(async () => {
    daw = createDawMcp({ port: PORT });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([daw.server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    tab?.close();
    tab = null;
    await client.close();
    await daw.close();
  });

  it('lists every schema parameter and reports no tab connected', async () => {
    const res = await call('list_parameters');
    const data = JSON.parse(res.content[0].text);
    expect(data.connected).toBe(false);
    const ids = data.parameters.map((p: { id: string }) => p.id);
    expect(ids).toContain('filter.cutoff');
    expect(ids).toContain('osc.waveform');
    expect(data.parameters.length).toBeGreaterThanOrEqual(7);
  });

  it('rejects unknown ids and out-of-range / bad-enum values', async () => {
    expect((await call('set_parameter', { id: 'nope', value: 1 })).isError).toBe(true);
    expect((await call('set_parameter', { id: 'filter.cutoff', value: 999999 })).isError).toBe(true);
    expect((await call('set_parameter', { id: 'osc.waveform', value: 'banana' })).isError).toBe(true);
  });

  it('errors on a valid set when no tab is connected', async () => {
    const res = await call('set_parameter', { id: 'filter.cutoff', value: 2000 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no daw tab/i);
  });

  it('forwards a valid set to the connected tab', async () => {
    const messages = await connectTab();
    const res = await call('set_parameter', { id: 'filter.cutoff', value: 2000 });
    expect(res.isError).toBeFalsy();
    await waitFor(() => messages.some((m) => (m as { type: string }).type === 'setParam'));
    expect(messages).toContainEqual({ type: 'setParam', id: 'filter.cutoff', value: 2000 });
  });

  it('play_note sends noteOn then noteOff after the duration', async () => {
    const messages = await connectTab();
    const res = await call('play_note', { midi: 60, durationMs: 40 });
    expect(res.isError).toBeFalsy();
    await waitFor(() => messages.some((m) => (m as { type: string }).type === 'noteOff'));
    const types = messages.map((m) => (m as { type: string }).type);
    expect(types).toEqual(['noteOn', 'noteOff']);
    expect(messages[0]).toEqual({ type: 'noteOn', midi: 60 });
  });

  it('play_sequence plays notes in order with paired on/off events', async () => {
    const messages = await connectTab();
    const res = await call('play_sequence', {
      notes: [
        { midi: 60, durationMs: 40 },
        { midi: 64, durationMs: 40 },
        { midi: 67, durationMs: 40 },
      ],
      articulationMs: 10,
    });
    expect(res.isError).toBeFalsy();
    await waitFor(() => messages.filter((m) => (m as { type: string }).type === 'noteOff').length === 3);
    const onNotes = messages
      .filter((m) => (m as { type: string }).type === 'noteOn')
      .map((m) => (m as { midi: number }).midi);
    expect(onNotes).toEqual([60, 64, 67]);
    expect(messages.filter((m) => (m as { type: string }).type === 'noteOff')).toHaveLength(3);
  });

  it('note_off requires a midi pitch', async () => {
    await connectTab();
    // missing required `midi` -> the SDK reports an error (reject or isError result)
    const bad = await call('note_off', {}).catch(
      (e: unknown): TextResult => ({ isError: true, content: [{ type: 'text', text: String(e) }] }),
    );
    expect(bad.isError).toBe(true);
    const ok = await call('note_off', { midi: 60 });
    expect(ok.isError).toBeFalsy();
  });

  it('add_note forwards to the tab and updates the mirror clip', async () => {
    const messages = await connectTab();
    const res = await call('add_note', { pitch: 60, start: 0, length: 1 });
    expect(res.isError).toBeFalsy();
    await waitFor(() => messages.some((m) => (m as { type: string }).type === 'addNote'));
    const added = messages.find((m) => (m as { type: string }).type === 'addNote') as {
      note: { pitch: number; start: number };
    };
    expect(added.note.pitch).toBe(60);

    const list = JSON.parse((await call('list_notes')).content[0].text);
    expect(list.clip.notes).toHaveLength(1);
    expect(list.clip.notes[0].pitch).toBe(60);
  });

  it('add_notes bulk-adds and clear_clip empties the clip', async () => {
    await connectTab();
    await call('add_notes', {
      notes: [
        { pitch: 60, start: 0 },
        { pitch: 64, start: 1 },
        { pitch: 67, start: 2 },
      ],
    });
    let list = JSON.parse((await call('list_notes')).content[0].text);
    expect(list.clip.notes).toHaveLength(3);

    await call('clear_clip');
    list = JSON.parse((await call('list_notes')).content[0].text);
    expect(list.clip.notes).toHaveLength(0);
  });

  it('set_tempo forwards and updates the mirror', async () => {
    const messages = await connectTab();
    const res = await call('set_tempo', { bpm: 90 });
    expect(res.isError).toBeFalsy();
    await waitFor(() => messages.some((m) => (m as { type: string }).type === 'setTempo'));
    const list = JSON.parse((await call('list_notes')).content[0].text);
    expect(list.clip.tempoBpm).toBe(90);
  });

  it('play / stop forward transport commands', async () => {
    const messages = await connectTab();
    await call('play');
    await call('stop');
    await waitFor(() => messages.filter((m) => (m as { type: string }).type === 'transport').length === 2);
    expect(messages.filter((m) => (m as { type: string }).type === 'transport')).toEqual([
      { type: 'transport', action: 'play' },
      { type: 'transport', action: 'stop' },
    ]);
  });
});
