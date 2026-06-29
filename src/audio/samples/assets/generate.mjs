/**
 * Generates the built-in drum kit as short, mono, 16-bit PCM WAV one-shots.
 *
 * These samples are synthesized from scratch here (no third-party audio), so the
 * output is original and unambiguously CC0 - safe to ship in the bundle. They are
 * deliberately simple "house kit" placeholders; users import their own samples for
 * anything richer. Regenerate with:  node src/audio/samples/assets/generate.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SAMPLE_RATE = 44100;
const here = dirname(fileURLToPath(import.meta.url));

const seconds = (n) => Math.round(n * SAMPLE_RATE);

// A tiny seeded PRNG so noise is deterministic (stable bytes across regenerations).
function makeNoise(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

const expDecay = (t, tau) => Math.exp(-t / tau);

/** Build a Float32 sample array from a per-sample synth function. */
function render(durationSec, fn) {
  const length = seconds(durationSec);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = fn(i / SAMPLE_RATE, i);
  return data;
}

const TWO_PI = Math.PI * 2;

const voices = {
  // Pitch-swept sine body with a short click transient.
  kick: () =>
    render(0.4, (t) => {
      const freq = 45 + (120 - 45) * expDecay(t, 0.03);
      const body = Math.sin(TWO_PI * freq * t) * expDecay(t, 0.12);
      const click = Math.sin(TWO_PI * 1800 * t) * expDecay(t, 0.004) * 0.4;
      return (body + click) * 0.9;
    }),

  // Tonal "shell" plus a noise layer.
  snare: () => {
    const noise = makeNoise(1);
    return render(0.22, (t) => {
      const tone = (Math.sin(TWO_PI * 180 * t) + Math.sin(TWO_PI * 260 * t)) * 0.5 * expDecay(t, 0.05);
      const snap = noise() * expDecay(t, 0.08);
      return (tone * 0.5 + snap * 0.7) * 0.8;
    });
  },

  // High-passed-ish noise via a simple difference filter; short tail.
  "hat-closed": () => {
    const noise = makeNoise(2);
    let prev = 0;
    return render(0.06, (t) => {
      const sample = noise();
      const hp = sample - prev;
      prev = sample;
      return hp * expDecay(t, 0.012) * 0.6;
    });
  },

  // Same source, longer tail.
  "hat-open": () => {
    const noise = makeNoise(3);
    let prev = 0;
    return render(0.35, (t) => {
      const sample = noise();
      const hp = sample - prev;
      prev = sample;
      return hp * expDecay(t, 0.12) * 0.55;
    });
  },

  // Three quick noise bursts then a tail - the classic clap stack.
  clap: () => {
    const noise = makeNoise(4);
    const bursts = [0, 0.01, 0.02];
    return render(0.18, (t) => {
      let env = expDecay(Math.max(0, t - 0.03), 0.05) * 0.6;
      for (const offset of bursts) {
        const dt = t - offset;
        if (dt >= 0 && dt < 0.01) env += expDecay(dt, 0.003);
      }
      return noise() * env * 0.7;
    });
  },

  // Bright, very short click.
  rim: () => {
    const noise = makeNoise(5);
    return render(0.05, (t) => {
      const tone = Math.sin(TWO_PI * 1700 * t) * expDecay(t, 0.006);
      const edge = noise() * expDecay(t, 0.003) * 0.5;
      return (tone + edge) * 0.7;
    });
  },

  // Pitch-swept sine, lower and longer than the kick's transient.
  tom: () =>
    render(0.3, (t) => {
      const freq = 90 + (180 - 90) * expDecay(t, 0.06);
      return Math.sin(TWO_PI * freq * t) * expDecay(t, 0.12) * 0.85;
    }),
};

/** Encode a Float32 array (-1..1) as a 16-bit PCM mono WAV Buffer. */
function encodeWav(samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }
  return buffer;
}

for (const [id, synth] of Object.entries(voices)) {
  const wav = encodeWav(synth());
  const path = join(here, `${id}.wav`);
  writeFileSync(path, wav);
  console.log(`wrote ${id}.wav (${wav.length} bytes)`);
}
