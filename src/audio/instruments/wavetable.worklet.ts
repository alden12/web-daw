/**
 * Wavetable AudioWorkletProcessor: a polyphonic morphing-wavetable synth, the thin
 * realtime shell over the pure `wavetable` DSP. Voices are a fixed pre-allocated pool
 * (no per-block allocation in the audio thread); note commands arrive via the port
 * with an absolute `when` and are dispatched at the matching sample within the block
 * (sample-accurate). Each voice runs a linear attack/release envelope; the summed
 * voices pass through a one-pole low-pass (`wt.tone`) and the master `amp.level`.
 *
 * Params are the schema's number params by the same names (see instruments/catalog
 * wavetableSchema), so WorkletInstrument binds them generically.
 */
import { buildTables, sampleTable } from '../dsp/wavetable';
import type { NoteMessage } from './WorkletInstrument';

const MAX_VOICES = 16;

interface Voice {
  stage: 'idle' | 'attack' | 'sustain' | 'release';
  midi: number;
  phase: number; // 0..1 cycle position
  inc: number; // cycles per sample
  velocity: number;
  env: number; // 0..1 envelope level
  releaseAt: number; // AudioContext time to auto-release (playNote); Infinity = held
  age: number; // for voice stealing (lower = older)
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

class WavetableProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'wt.position', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wt.tone', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'amp.level', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'env.attack', defaultValue: 8, minValue: 1, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'env.release', defaultValue: 300, minValue: 1, maxValue: 4000, automationRate: 'k-rate' },
    ];
  }

  private tables: Float32Array[] = buildTables();
  private voices: Voice[] = Array.from({ length: MAX_VOICES }, () => ({
    stage: 'idle' as const,
    midi: 0,
    phase: 0,
    inc: 0,
    velocity: 0,
    env: 0,
    releaseAt: Infinity,
    age: 0,
  }));
  private pending: NoteMessage[] = [];
  private lp = 0; // one-pole low-pass state
  private clock = 0; // monotonic counter for voice-steal age

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<NoteMessage>) => this.pending.push(e.data);
  }

  private allocate(): Voice {
    let pick = this.voices.find((v) => v.stage === 'idle');
    if (!pick) {
      // Steal the oldest voice (lowest age).
      pick = this.voices[0];
      for (const v of this.voices) if (v.age < pick.age) pick = v;
    }
    return pick;
  }

  private startVoice(midi: number, velocity: number, releaseAt: number): void {
    const v = this.allocate();
    v.stage = 'attack';
    v.midi = midi;
    v.phase = 0;
    v.inc = midiToFreq(midi) / sampleRate;
    v.velocity = velocity;
    v.env = 0;
    v.releaseAt = releaseAt;
    v.age = this.clock++;
  }

  private releaseMidi(midi: number): void {
    for (const v of this.voices) {
      if (v.midi === midi && (v.stage === 'attack' || v.stage === 'sustain')) v.stage = 'release';
    }
  }

  private handle(msg: NoteMessage): void {
    if (msg.kind === 'on') this.startVoice(msg.midi, msg.velocity, Infinity);
    else if (msg.kind === 'play') this.startVoice(msg.midi, msg.velocity, msg.when + msg.durationSec);
    else if (msg.kind === 'off') this.releaseMidi(msg.midi);
    else for (const v of this.voices) if (v.stage !== 'idle') v.stage = 'release';
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const frames = out.length;
    const position = parameters['wt.position'][0];
    const tone = parameters['wt.tone'][0];
    const level = parameters['amp.level'][0];
    const attackInc = 1 / (Math.max(0.001, parameters['env.attack'][0] / 1000) * sampleRate);
    const releaseDec = 1 / (Math.max(0.001, parameters['env.release'][0] / 1000) * sampleRate);
    const toneCoef = tone * tone; // one-pole coefficient: 1 = open, ~0 = dark
    const blockStart = currentTime;
    const secPerFrame = 1 / sampleRate;

    for (let i = 0; i < frames; i++) {
      const sampleTime = blockStart + i * secPerFrame;
      // Dispatch any note commands due at or before this sample (sample-accurate).
      if (this.pending.length) {
        let w = 0;
        for (let r = 0; r < this.pending.length; r++) {
          const msg = this.pending[r];
          if (msg.when <= sampleTime) this.handle(msg);
          else this.pending[w++] = msg; // keep future events, compacting in place
        }
        this.pending.length = w;
      }

      let mix = 0;
      for (const v of this.voices) {
        if (v.stage === 'idle') continue;
        if (v.releaseAt <= sampleTime && (v.stage === 'attack' || v.stage === 'sustain')) v.stage = 'release';
        if (v.stage === 'attack') {
          v.env += attackInc;
          if (v.env >= 1) {
            v.env = 1;
            v.stage = 'sustain';
          }
        } else if (v.stage === 'release') {
          v.env -= releaseDec;
          if (v.env <= 0) {
            v.env = 0;
            v.stage = 'idle';
            continue;
          }
        }
        mix += sampleTable(this.tables, position, v.phase) * v.env * v.velocity;
        v.phase += v.inc;
        if (v.phase >= 1) v.phase -= 1;
      }

      this.lp += toneCoef * (mix - this.lp);
      out[i] = this.lp * level;
    }
    return true;
  }
}

registerProcessor('wavetable-processor', WavetableProcessor);
