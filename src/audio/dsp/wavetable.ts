/**
 * Pure wavetable DSP (no DOM, so it is unit-testable on its own) shared by the
 * wavetable worklet processor. A wavetable synth stores a small bank of single-cycle
 * waveforms and morphs between them: `position` (0..1) crossfades across the bank,
 * `phase` (0..1) reads within a cycle. The brighter tables are built additively from
 * a bounded number of partials so a high note doesn't alias into harsh garbage.
 */

export const TABLE_SIZE = 2048;
const PARTIALS = 32; // harmonics in the additive tables (bounds aliasing)

/** Build one single-cycle table from per-harmonic amplitudes `amp(k)` (k = 1..PARTIALS). */
function additive(amp: (k: number) => number): Float32Array {
  const table = new Float32Array(TABLE_SIZE);
  let peak = 0;
  for (let i = 0; i < TABLE_SIZE; i++) {
    const t = (i / TABLE_SIZE) * 2 * Math.PI;
    let sum = 0;
    for (let k = 1; k <= PARTIALS; k++) sum += amp(k) * Math.sin(k * t);
    table[i] = sum;
    peak = Math.max(peak, Math.abs(sum));
  }
  if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) table[i] /= peak; // normalize to [-1, 1]
  return table;
}

/**
 * The morph bank, dark -> bright: sine, triangle (odd harmonics 1/k^2), square
 * (odd harmonics 1/k), sawtooth (all harmonics 1/k).
 */
export function buildTables(): Float32Array[] {
  return [
    additive((k) => (k === 1 ? 1 : 0)),
    additive((k) => (k % 2 === 1 ? (((k - 1) / 2) % 2 === 0 ? 1 : -1) / (k * k) : 0)),
    additive((k) => (k % 2 === 1 ? 1 / k : 0)),
    additive((k) => 1 / k),
  ];
}

/** Read one table at a fractional phase (0..1), linearly interpolated and wrapping. */
export function sampleOne(table: Float32Array, phase: number): number {
  const n = table.length;
  const pos = (phase - Math.floor(phase)) * n; // wrap phase into [0, 1)
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const a = table[i0 % n];
  const b = table[(i0 + 1) % n];
  return a + (b - a) * frac;
}

/**
 * Sample the morph bank: crossfade the two tables adjacent to `position` (0..1),
 * each read at `phase` (0..1). An empty bank yields silence.
 */
export function sampleTable(tables: Float32Array[], position: number, phase: number): number {
  if (tables.length === 0) return 0;
  if (tables.length === 1) return sampleOne(tables[0], phase);
  const p = Math.min(1, Math.max(0, position)) * (tables.length - 1);
  const t0 = Math.floor(p);
  const t1 = Math.min(t0 + 1, tables.length - 1);
  const frac = p - t0;
  const a = sampleOne(tables[t0], phase);
  const b = sampleOne(tables[t1], phase);
  return a + (b - a) * frac;
}
