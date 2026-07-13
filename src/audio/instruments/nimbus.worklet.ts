/**
 * Nimbus AudioWorkletProcessor: a warm, Juno-inspired polyphonic subtractive synth -
 * the thin realtime shell over the pure `oscillators` + `ladder` DSP. Each voice mixes
 * band-limited saw + pulse (with PWM) + a sub-oscillator + noise, runs it through a
 * four-pole resonant ladder filter, and shapes it with a full ADSR (the amp envelope,
 * which also modulates the filter). One global LFO (with a fade-in delay) vibratos the
 * pitch, sweeps the filter, and wobbles the pulse width; a touch of per-voice drift
 * keeps it from sounding static.
 *
 * Voices are a fixed pre-allocated pool (no per-block allocation on the audio thread);
 * note commands arrive via the port with an absolute `when` and are dispatched at the
 * matching sample (sample-accurate). Continuous modulation (pitch, pulse width, filter
 * cutoff) is refreshed once per block - inaudible, and it keeps the per-sample loop to
 * oscillators + filter + envelope. Param names match the schema (instruments/catalog
 * nimbusSchema), so WorkletInstrument binds them generically.
 */
import { polyBlepSaw, polyBlepPulse } from "../dsp/oscillators";
import { makeLadderState, ladderCoeffs, ladderStep, type LadderState, type LadderCoeffs } from "../dsp/ladder";
import type { NoteMessage } from "./WorkletInstrument";

const MAX_VOICES = 16;
const HEADROOM = 0.3; // tames polyphonic summing; the master limiter catches peaks

type Stage = "idle" | "attack" | "decay" | "sustain" | "release";

interface Voice {
  stage: Stage;
  midi: number;
  velocity: number;
  baseFreq: number;
  phase: number; // main oscillator phase, 0..1
  subPhase: number; // sub oscillator phase (one octave down)
  env: number; // 0..1 envelope level
  filter: LadderState;
  coeffs: LadderCoeffs; // refreshed per block
  inc: number; // main phase increment (per block)
  subInc: number; // sub phase increment (per block)
  pw: number; // pulse width (per block)
  drift: number; // per-voice random tuning offset, -1..1
  releaseAt: number; // AudioContext time to auto-release (playNote); Infinity = held
  age: number; // for voice stealing (lower = older)
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

class NimbusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): AudioParamDescriptor[] {
    const k = "k-rate" as const;
    return [
      { name: "osc.saw", defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: k },
      { name: "osc.pulse", defaultValue: 0.0, minValue: 0, maxValue: 1, automationRate: k },
      { name: "osc.pulseWidth", defaultValue: 0.5, minValue: 0.05, maxValue: 0.95, automationRate: k },
      { name: "osc.sub", defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: k },
      { name: "osc.noise", defaultValue: 0.0, minValue: 0, maxValue: 1, automationRate: k },
      { name: "osc.drift", defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: k },
      { name: "filter.cutoff", defaultValue: 3000, minValue: 20, maxValue: 18000, automationRate: k },
      { name: "filter.resonance", defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: k },
      { name: "filter.env", defaultValue: 0.4, minValue: -1, maxValue: 1, automationRate: k },
      { name: "filter.keytrack", defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: k },
      { name: "env.attack", defaultValue: 6, minValue: 1, maxValue: 4000, automationRate: k },
      { name: "env.decay", defaultValue: 200, minValue: 1, maxValue: 4000, automationRate: k },
      { name: "env.sustain", defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: k },
      { name: "env.release", defaultValue: 300, minValue: 1, maxValue: 6000, automationRate: k },
      { name: "lfo.rate", defaultValue: 5, minValue: 0.05, maxValue: 20, automationRate: k },
      { name: "lfo.pitch", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: "lfo.filter", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: "lfo.pwm", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: k },
      { name: "lfo.delay", defaultValue: 0, minValue: 0, maxValue: 4000, automationRate: k },
      { name: "amp.level", defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: k },
    ];
  }

  private voices: Voice[] = Array.from({ length: MAX_VOICES }, () => ({
    stage: "idle" as Stage,
    midi: 0,
    velocity: 0,
    baseFreq: 0,
    phase: 0,
    subPhase: 0,
    env: 0,
    filter: makeLadderState(),
    coeffs: ladderCoeffs(3000, 0.2, sampleRate),
    inc: 0,
    subInc: 0,
    pw: 0.5,
    drift: 0,
    releaseAt: Infinity,
    age: 0,
  }));
  private pending: NoteMessage[] = [];
  private clock = 0; // monotonic counter for voice-steal age
  private lfoPhase = 0; // 0..1
  private lfoGain = 0; // fade-in level (0..1), ramps while any voice is active
  private seed = 12345; // deterministic per-voice drift (no Math.random dependency)

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<NoteMessage>) => this.pending.push(e.data);
  }

  // Small deterministic PRNG so per-voice drift varies without depending on the host
  // Math.random (which some sandboxes forbid); noise uses it too.
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 0xffffffff; // 0..1
  }

  private allocate(): Voice {
    let pick = this.voices.find((voice) => voice.stage === "idle");
    if (!pick) {
      pick = this.voices[0];
      for (const voice of this.voices) if (voice.age < pick.age) pick = voice;
    }
    return pick;
  }

  private startVoice(midi: number, velocity: number, releaseAt: number): void {
    const voice = this.allocate();
    voice.stage = "attack";
    voice.midi = midi;
    voice.velocity = velocity;
    voice.baseFreq = midiToFreq(midi);
    voice.phase = 0;
    voice.subPhase = 0;
    voice.env = 0;
    voice.filter = makeLadderState();
    voice.drift = this.rand() * 2 - 1;
    voice.releaseAt = releaseAt;
    voice.age = this.clock++;
  }

  private releaseMidi(midi: number): void {
    for (const voice of this.voices)
      if (voice.midi === midi && voice.stage !== "idle" && voice.stage !== "release") voice.stage = "release";
  }

  private handle(msg: NoteMessage): void {
    if (msg.kind === "on") this.startVoice(msg.midi, msg.velocity, Infinity);
    else if (msg.kind === "play") this.startVoice(msg.midi, msg.velocity, msg.when + msg.durationSec);
    else if (msg.kind === "off") this.releaseMidi(msg.midi);
    else for (const voice of this.voices) if (voice.stage !== "idle") voice.stage = "release";
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const frames = out.length;
    const p = (name: string) => parameters[name][0];

    const sawLevel = p("osc.saw");
    const pulseLevel = p("osc.pulse");
    const subLevel = p("osc.sub");
    const noiseLevel = p("osc.noise");
    const basePw = p("osc.pulseWidth");
    const drift = p("osc.drift");
    const baseCutoff = p("filter.cutoff");
    const resonance = p("filter.resonance");
    const filterEnv = p("filter.env");
    const keytrack = p("filter.keytrack");
    const sustain = p("env.sustain");
    const level = p("amp.level");

    const secPerSample = 1 / sampleRate;
    const attackInc = 1 / Math.max(0.001, p("env.attack") / 1000) / sampleRate;
    const decayRate = (1 - sustain) / Math.max(0.001, p("env.decay") / 1000) / sampleRate;
    const releaseDec = 1 / Math.max(0.001, p("env.release") / 1000) / sampleRate;

    // Global LFO: value sampled at block start (destinations are block-rate), faded in
    // over `lfo.delay` while any voice sounds and reset to silent when the pool empties.
    const lfoRate = p("lfo.rate");
    const anyActive = this.voices.some((voice) => voice.stage !== "idle");
    if (!anyActive) this.lfoGain = 0;
    else {
      const delayMs = p("lfo.delay");
      this.lfoGain =
        delayMs <= 1 ? 1 : Math.min(1, this.lfoGain + frames / (Math.max(0.001, delayMs / 1000) * sampleRate));
    }
    const lfo = Math.sin(2 * Math.PI * this.lfoPhase) * this.lfoGain;
    const lfoPitch = p("lfo.pitch");
    const lfoFilter = p("lfo.filter");
    const lfoPwm = p("lfo.pwm");

    // Per-block modulation: refresh each active voice's tuning, pulse width, and filter
    // coefficients from the current envelope + LFO. The per-sample loop below is then
    // just oscillators -> ladder -> envelope.
    const pwMod = clamp(basePw + lfo * lfoPwm * 0.4, 0.05, 0.95);
    const pitchMult = Math.pow(2, (lfo * lfoPitch * 50) / 1200); // +/- 50 cents vibrato
    for (const voice of this.voices) {
      if (voice.stage === "idle") continue;
      const detuneMult = Math.pow(2, (voice.drift * drift * 6) / 1200); // +/- 6 cents drift
      voice.inc = (voice.baseFreq * detuneMult * pitchMult) / sampleRate;
      voice.subInc = voice.inc * 0.5;
      voice.pw = pwMod;
      const octaves = filterEnv * 4 * voice.env + keytrack * ((voice.midi - 60) / 12) + lfo * lfoFilter * 2;
      voice.coeffs = ladderCoeffs(clamp(baseCutoff * Math.pow(2, octaves), 20, 18000), resonance, sampleRate);
    }

    for (let i = 0; i < frames; i++) {
      const sampleTime = currentTime + i * secPerSample;
      if (this.pending.length) {
        let write = 0;
        for (let read = 0; read < this.pending.length; read++) {
          const msg = this.pending[read];
          if (msg.when <= sampleTime) this.handle(msg);
          else this.pending[write++] = msg; // keep future events, compacting in place
        }
        this.pending.length = write;
      }

      let mix = 0;
      for (const voice of this.voices) {
        if (voice.stage === "idle") continue;

        // Envelope (per sample, so the VCA stays smooth).
        if (voice.releaseAt <= sampleTime && voice.stage !== "release") voice.stage = "release";
        if (voice.stage === "attack") {
          voice.env += attackInc;
          if (voice.env >= 1) {
            voice.env = 1;
            voice.stage = "decay";
          }
        } else if (voice.stage === "decay") {
          voice.env -= decayRate;
          if (decayRate <= 0 || voice.env <= sustain) {
            voice.env = sustain;
            voice.stage = "sustain";
          }
        } else if (voice.stage === "release") {
          voice.env -= releaseDec;
          if (voice.env <= 0) {
            voice.env = 0;
            voice.stage = "idle";
            continue;
          }
        }

        const saw = sawLevel !== 0 ? polyBlepSaw(voice.phase, voice.inc) * sawLevel : 0;
        const pulse = pulseLevel !== 0 ? polyBlepPulse(voice.phase, voice.inc, voice.pw) * pulseLevel : 0;
        const sub = subLevel !== 0 ? polyBlepPulse(voice.subPhase, voice.subInc, 0.5) * subLevel : 0;
        const noise = noiseLevel !== 0 ? (this.rand() * 2 - 1) * noiseLevel : 0;
        const filtered = ladderStep(saw + pulse + sub + noise, voice.coeffs, voice.filter);
        mix += filtered * voice.env * voice.velocity;

        voice.phase += voice.inc;
        if (voice.phase >= 1) voice.phase -= 1;
        voice.subPhase += voice.subInc;
        if (voice.subPhase >= 1) voice.subPhase -= 1;
      }

      out[i] = mix * level * HEADROOM;
    }

    this.lfoPhase += (lfoRate * frames) / sampleRate;
    if (this.lfoPhase >= 1) this.lfoPhase -= Math.floor(this.lfoPhase);
    return true;
  }
}

registerProcessor("nimbus-processor", NimbusProcessor);
