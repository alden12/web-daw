/**
 * The instrument-side analog of BaseEffect: an Instrument backed by an
 * AudioWorkletProcessor. `output` is the worklet node itself (mono). Note events are
 * posted to the processor with their absolute AudioContext `when`, which the
 * scheduler's lookahead supplies ahead of time so the processor can place them
 * sample-accurately. Params are bound generically: every *number* param in the
 * schema binds to the processor's same-named AudioParam through the usual `rampParam`
 * smoothing path - so a worklet instrument needs no per-param code, just a processor
 * name and a matching set of `parameterDescriptors`.
 */
import type { ParamStore } from '../params/store';
import type { Instrument } from './types';
import { bindParams, rampParam, type ParamBinding } from './binding';

/** A note command sent to a worklet processor (all times are AudioContext seconds). */
export type NoteMessage =
  | { kind: 'on'; midi: number; velocity: number; when: number }
  | { kind: 'off'; midi: number; when: number }
  | { kind: 'play'; midi: number; velocity: number; durationSec: number; when: number }
  | { kind: 'allOff'; when: number };

export class WorkletInstrument implements Instrument {
  readonly output: AudioWorkletNode;
  private readonly ctx: AudioContext;
  private readonly node: AudioWorkletNode;
  private unsubscribe: (() => void) | null = null;

  constructor(ctx: AudioContext, store: ParamStore, processorName: string) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, processorName, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.output = this.node;

    // Bind each number param to the processor's same-named AudioParam.
    const bindings: Record<string, ParamBinding> = {};
    for (const spec of store.allSpecs()) {
      if (spec.kind !== 'number') continue;
      const param = this.node.parameters.get(spec.id);
      if (!param) continue;
      bindings[spec.id] = { apply: (v, ms) => rampParam(ctx, param, v as number, ms) };
    }
    this.unsubscribe = bindParams(store, bindings);
  }

  private post(message: NoteMessage): void {
    this.node.port.postMessage(message);
  }

  noteOn(midi: number, velocity = 1, when?: number): void {
    this.post({ kind: 'on', midi, velocity, when: when ?? this.ctx.currentTime });
  }

  noteOff(midi: number, when?: number): void {
    this.post({ kind: 'off', midi, when: when ?? this.ctx.currentTime });
  }

  playNote(midi: number, durationSec: number, velocity = 1, when?: number): void {
    this.post({ kind: 'play', midi, velocity, durationSec, when: when ?? this.ctx.currentTime });
  }

  allNotesOff(): void {
    this.post({ kind: 'allOff', when: this.ctx.currentTime });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.allNotesOff();
    this.node.disconnect();
  }
}
