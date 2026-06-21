/**
 * The effect abstraction. A track owns an ordered chain of effects; each sits
 * between the instrument output and the track gain. An effect is a node with an
 * input and an output, driven (like instruments) by its own ParamStore, so the
 * UI, MCP, and persistence treat it uniformly.
 */
export interface Effect {
  /** Feed the upstream signal here. */
  readonly input: AudioNode;
  /** The processed signal; connect into the next effect or the track gain. */
  readonly output: AudioNode;
  dispose(): void;
}
