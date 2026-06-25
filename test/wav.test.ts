import { describe, expect, it } from 'vitest';
import { encodeWav, encodeWavBuffer } from '../src/audio/recording/wav';

const ascii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join('');

describe('encodeWavBuffer', () => {
  it('writes a valid 16-bit mono PCM header sized to the samples', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buf = encodeWavBuffer(samples, 48000);
    const view = new DataView(buf);

    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(ascii(view, 36, 4)).toBe('data');

    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(48000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(samples.length * 2); // data size
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2); // riff size
  });

  it('converts float samples to clamped 16-bit ints', () => {
    const buf = encodeWavBuffer(new Float32Array([0, 1, -1, 2, -2]), 44100);
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767); // +1 full scale
    expect(view.getInt16(48, true)).toBe(-32768); // -1 full scale
    expect(view.getInt16(50, true)).toBe(32767); // clamped above +1
    expect(view.getInt16(52, true)).toBe(-32768); // clamped below -1
  });

  it('handles an empty take (header only)', () => {
    expect(encodeWavBuffer(new Float32Array(0), 48000).byteLength).toBe(44);
  });
});

describe('encodeWav', () => {
  it('wraps the buffer in an audio/wav blob', () => {
    const blob = encodeWav(new Float32Array([0.1, -0.1]), 48000);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 2 * 2);
  });
});
