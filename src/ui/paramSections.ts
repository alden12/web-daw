/**
 * Grouping a param schema into labeled sections by id namespace (the part before the
 * dot: `osc.` / `filter.` / `pad3.` / ...), shared by the instrument panel and the drum
 * panel. Numbered pad sections sort first (in pad order), then the known synth sections
 * in signal-flow order, then any unknown namespace (title-cased).
 */
import type { ParamSpec } from "../audio/params/types";

/** Friendly titles + display order for known id namespaces (the part before the dot). */
export const SECTION_LABELS: Record<string, string> = {
  lfo: "LFO",
  osc: "Oscillator",
  fm: "FM",
  super: "Unison",
  organ: "Tone",
  wt: "Wavetable",
  sampler: "Sampler",
  filter: "Filter",
  env: "Envelope",
  amp: "Amp",
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);

export const namespaceOf = (id: string) => (id.includes(".") ? id.slice(0, id.indexOf(".")) : id);
export const padNumber = (namespace: string) => /^pad(\d+)$/.exec(namespace)?.[1];

export const sectionTitle = (namespace: string) => {
  const pad = padNumber(namespace);
  if (pad) return `Pad ${pad}`;
  return SECTION_LABELS[namespace] ?? namespace.charAt(0).toUpperCase() + namespace.slice(1);
};

/** Sort key: numbered pad sections first (in pad order), then the known synth sections
 *  (lfo -> ... -> amp), then any other namespace. */
export function sectionRank(namespace: string): number {
  const pad = padNumber(namespace);
  if (pad) return Number(pad); // 1..N, before everything else
  const known = SECTION_ORDER.indexOf(namespace);
  return known === -1 ? 1000 : 100 + known;
}

export interface ParamSection {
  namespace: string;
  specs: ParamSpec[];
}

/** Group a schema into ordered sections by id namespace, preserving in-section order. */
export function toSections(schema: readonly ParamSpec[]): ParamSection[] {
  const groups = new Map<string, ParamSpec[]>();
  for (const spec of schema) {
    const namespace = namespaceOf(spec.id);
    const specs = groups.get(namespace) ?? [];
    specs.push(spec);
    groups.set(namespace, specs);
  }
  return [...groups.keys()]
    .sort((a, b) => sectionRank(a) - sectionRank(b))
    .map((namespace) => ({ namespace, specs: groups.get(namespace)! }));
}
