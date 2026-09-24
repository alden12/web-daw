/**
 * Lookup tables on a parameter binding (INST-17): the one way a bound field can be a non-linear
 * function of its param. A table is `[input, output]` points sorted by input; a value between two
 * points is read off the straight line joining them, and one outside the table takes the nearest
 * end. Pure and DOM-free, so the interpreter, the note path, the validators and the Node server
 * share it.
 */
import type { NumberRef, TablePoint } from "./types";

/** Read `input` off a table: piecewise-linear between points, clamped at both ends. */
export function lookupTable(points: readonly TablePoint[], input: number): number {
  const [firstInput, firstOutput] = points[0];
  if (input <= firstInput) return firstOutput;
  const upper = points.findIndex(([pointInput]) => pointInput >= input);
  if (upper === -1) return points[points.length - 1][1];
  const [fromInput, fromOutput] = points[upper - 1];
  const [toInput, toOutput] = points[upper];
  return fromOutput + ((input - fromInput) / (toInput - fromInput)) * (toOutput - fromOutput);
}

/** What is wrong with a table, or null when it is usable: two points or more, inputs ascending. */
export function tableProblem(points: readonly TablePoint[]): string | null {
  if (points.length < 2) return "a table needs at least two points";
  const ascending = points.every((point, index) => index === 0 || point[0] > points[index - 1][0]);
  return ascending ? null : "a table's inputs must be in ascending order, with no repeats";
}

/** Sample `curve` at `count` evenly spaced inputs across [from, to]: a table standing in for it. */
export const tableOf = (curve: (input: number) => number, from: number, to: number, count: number): TablePoint[] =>
  Array.from({ length: count }, (_unused, index) => {
    const input = from + ((to - from) * index) / (count - 1);
    return [input, curve(input)];
  });

/** A numeric parameter reference's value for a raw param value: read off its table if it has
 *  one, then raw*scale + offset (defaults 1, 0). */
export function resolveNumber(raw: number, ref: Omit<NumberRef, "param">): number {
  const looked = ref.table ? lookupTable(ref.table, raw) : raw;
  return looked * (ref.scale ?? 1) + (ref.offset ?? 0);
}
