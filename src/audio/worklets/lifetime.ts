/**
 * The lifetime of a processor that transforms its input (a custom-DSP graph node, INST-15), as the
 * value `process` returns. Returning false lets the browser stop a node with nothing playing into
 * it, and collect it once disconnected, but a processor that returns false before its input has
 * started is stopped for good - and in an instrument voice the node is built before the note
 * starts. So: keep running until input first arrives, then only while it lasts.
 */
export function keepAlive(): (input: Float32Array[] | undefined) => boolean {
  let heard = false;
  return (input) => {
    const playing = (input?.length ?? 0) > 0;
    if (playing) heard = true;
    return playing || !heard;
  };
}
