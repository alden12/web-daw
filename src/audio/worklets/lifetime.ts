/**
 * The lifetime of a custom-DSP graph node's processor (INST-15), as the value `process` returns.
 * Returning false tells the browser the processor is finished once nothing plays into it, and
 * that is final: it is never run again, even if something is connected later.
 *
 * - In an instrument voice (`transient`), that is what we want once the note is over, so the
 *   voice's copy can be collected rather than running forever - but the node is built before the
 *   note starts, so it keeps running until input first arrives, then only while it lasts.
 * - Anywhere else (an effect), it runs for as long as the node exists: the engine rewires an effect
 *   chain in place, and a moment disconnected would otherwise silence the effect for good.
 */
export function lifetime(transient: boolean): (input: Float32Array[] | undefined) => boolean {
  if (!transient) return () => true;
  let heard = false;
  return (input) => {
    const playing = (input?.length ?? 0) > 0;
    if (playing) heard = true;
    return playing || !heard;
  };
}

/** The processor options a graph node is built with: whether it lives only as long as a note. */
export interface GraphNodeOptions {
  transient?: boolean;
}

/** Read `transient` from a processor's construction options. */
export const isTransient = (options?: AudioWorkletNodeOptions): boolean =>
  Boolean((options?.processorOptions as GraphNodeOptions | undefined)?.transient);
