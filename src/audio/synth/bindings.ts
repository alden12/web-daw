/**
 * The binding layer: the seam that keeps the parameter store transport-agnostic.
 *
 * Each parameter id maps to a `ParamBinding` that knows how to apply a value to
 * *something* in the audio engine. Today every binding targets a native Web
 * Audio `AudioParam` or per-voice state. When a parameter later moves to a
 * custom AudioWorklet, only its binding changes here - the schema, store, UI,
 * MCP, and patch format are untouched.
 */
import type { ParamValue } from '../params/types';
import type { Waveform } from './schema';

export interface ParamBinding {
  /** Apply a value, optionally ramping over `smoothMs` to avoid zipper noise. */
  apply(value: ParamValue, smoothMs?: number): void;
}

/** Mutable settings used to build each new voice. Live voices are poked where legal. */
export interface VoiceState {
  waveform: Waveform;
  detune: number;
  attackMs: number;
  releaseMs: number;
}

export interface PersistentNodes {
  filter: BiquadFilterNode;
  masterGain: GainNode;
}

/** Voice the synth is currently sounding, if any (for live parameter pokes). */
export interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/** Ramp a native AudioParam toward a value, smoothing if requested. */
function rampParam(ctx: BaseAudioContext, param: AudioParam, value: number, smoothMs?: number): void {
  const now = ctx.currentTime;
  if (smoothMs && smoothMs > 0) {
    // setTargetAtTime's time constant ~= the time to reach 63% of the target.
    param.setTargetAtTime(value, now, smoothMs / 1000);
  } else {
    param.setValueAtTime(value, now);
  }
}

export function buildBindings(
  ctx: BaseAudioContext,
  nodes: PersistentNodes,
  voiceState: VoiceState,
  getVoices: () => Iterable<Voice>,
): Record<string, ParamBinding> {
  return {
    // --- Persistent-node params: applied to a live AudioParam immediately. ---
    'filter.cutoff': {
      apply: (v, smoothMs) => rampParam(ctx, nodes.filter.frequency, v as number, smoothMs),
    },
    'filter.resonance': {
      apply: (v, smoothMs) => rampParam(ctx, nodes.filter.Q, v as number, smoothMs),
    },
    'amp.level': {
      apply: (v, smoothMs) => rampParam(ctx, nodes.masterGain.gain, v as number, smoothMs),
    },

    // --- Per-voice params: stored for new voices; all live voices poked too. ---
    'osc.waveform': {
      apply: (v) => {
        voiceState.waveform = v as Waveform;
        for (const voice of getVoices()) voice.osc.type = v as Waveform;
      },
    },
    'osc.detune': {
      apply: (v, smoothMs) => {
        voiceState.detune = v as number;
        for (const voice of getVoices()) rampParam(ctx, voice.osc.detune, v as number, smoothMs);
      },
    },
    'env.attack': {
      apply: (v) => {
        voiceState.attackMs = v as number;
      },
    },
    'env.release': {
      apply: (v) => {
        voiceState.releaseMs = v as number;
      },
    },
  };
}
