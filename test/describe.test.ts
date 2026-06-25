import { describe, expect, it } from 'vitest';
import { describeCommand } from '../src/audio/commands/describe';
import type { EditCommand } from '../src/audio/commands/types';

describe('describeCommand', () => {
  it('describes a known command', () => {
    expect(describeCommand({ type: 'setTempo', bpm: 120 })).toBe('Set tempo 120');
  });

  it('falls back to the raw type for an unknown/legacy command (no crash)', () => {
    // A restored log may hold a pre-rename command type the map no longer knows.
    const legacy = { type: 'addVariant', trackId: 't-1', id: 'v-1' } as unknown as EditCommand;
    expect(describeCommand(legacy)).toBe('addVariant');
  });
});
