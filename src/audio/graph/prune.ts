/**
 * Trim a voice graph to what a note actually plays (INST-13). A `buffer` node with a `note` only
 * sounds for that note - a drum kit is one per pad - so the rest are left out of the voice, and
 * so is anything downstream that is then left with no audio going into it: a node with no input
 * makes silence, so dropping it changes nothing you can hear. A 32-pad kit then builds one pad's
 * nodes per hit rather than all 32.
 *
 * Pure and DOM-free, so it is tested on data.
 */
import type { Connection, Graph, NodeSpec } from "./types";
import { SOURCE_KINDS } from "./vocabulary";

/** Where a connection lands, without any `.param`. */
const targetOf = (to: string): string => to.split(".")[0];
/** Whether a connection feeds a node's audio input, rather than modulating one of its params. */
const isAudioInput = (to: string): boolean => !to.includes(".");

/**
 * Keep the nodes `keep` accepts, then drop, until nothing more goes, every node that is not a
 * source and has no audio input left from a node still present or a reserved endpoint.
 */
export function pruneGraph(graph: Graph, keep: (node: NodeSpec) => boolean, reserved: readonly string[]): Graph {
  const prune = (nodes: NodeSpec[]): NodeSpec[] => {
    const present = new Set([...nodes.map((node) => node.id), ...reserved]);
    const fed = new Set(
      graph.connections.filter(([from, to]) => present.has(from) && isAudioInput(to)).map(([, to]) => targetOf(to)),
    );
    const remaining = nodes.filter((node) => SOURCE_KINDS.includes(node.kind) || fed.has(node.id));
    return remaining.length === nodes.length ? nodes : prune(remaining);
  };
  const nodes = prune(graph.nodes.filter(keep));
  if (nodes.length === graph.nodes.length) return graph;
  const present = new Set([...nodes.map((node) => node.id), ...reserved]);
  const connections = graph.connections.filter(
    ([from, to]: Connection) => present.has(from) && present.has(targetOf(to)),
  );
  return { nodes, connections };
}
