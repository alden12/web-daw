/**
 * Semantic diff between two project snapshots: a list of human-readable, musical
 * changes ("Lead: filter.cutoff 400 -> 800", "+4 notes in clip A") rather than a
 * text diff (DESIGN.md section 7). Pure functions over ProjectData, so the version
 * timeline (15B.4) and any history tooling can render "what changed" between commits.
 */
import type { ProjectData, TrackData, NoteClipData, AudioClipData } from "../project/types";
import type { PatchValues, ParamValue } from "../params/types";

/** Readable changes turning snapshot `from` into snapshot `to`. */
export function diffProjects(from: ProjectData, to: ProjectData): string[] {
  const lines: string[] = [];
  if (from.tempoBpm !== to.tempoBpm) lines.push(`Tempo ${from.tempoBpm} -> ${to.tempoBpm} BPM`);
  if (from.lengthBeats !== to.lengthBeats) lines.push(`Length ${from.lengthBeats} -> ${to.lengthBeats} beats`);

  const before = new Map(from.tracks.map((t) => [t.id, t]));
  const after = new Map(to.tracks.map((t) => [t.id, t]));
  for (const t of to.tracks) if (!before.has(t.id)) lines.push(`+ Track "${t.name}"`);
  for (const t of from.tracks) if (!after.has(t.id)) lines.push(`- Track "${t.name}"`);
  for (const t of to.tracks) {
    const prev = before.get(t.id);
    if (prev) lines.push(...diffTrack(prev, t));
  }
  return lines;
}

function diffTrack(prev: TrackData, cur: TrackData): string[] {
  const lines: string[] = [];
  const name = cur.name;
  if (prev.name !== cur.name) lines.push(`Track "${prev.name}" renamed to "${cur.name}"`);

  // Synth patch (instrument tracks only).
  if (prev.kind === "instrument" && cur.kind === "instrument") {
    lines.push(...diffParams(name, prev.params ?? {}, cur.params ?? {}));
  }

  // Effect chain: add / remove / bypass / param changes.
  const pf = new Map((prev.effects ?? []).map((e) => [e.id, e]));
  const cf = new Map((cur.effects ?? []).map((e) => [e.id, e]));
  for (const e of cur.effects ?? []) if (!pf.has(e.id)) lines.push(`${name}: +effect ${e.type}`);
  for (const e of prev.effects ?? []) if (!cf.has(e.id)) lines.push(`${name}: -effect ${e.type}`);
  for (const e of cur.effects ?? []) {
    const p = pf.get(e.id);
    if (!p) continue;
    if (p.bypassed !== e.bypassed) lines.push(`${name}: ${e.type} ${e.bypassed ? "bypassed" : "enabled"}`);
    lines.push(...diffParams(`${name}: ${e.type}`, p.params, e.params));
  }

  // Clip pool: add / remove / note-count changes.
  const pc = new Map((prev.clips ?? []).map((c) => [c.id, c]));
  const cc = new Map((cur.clips ?? []).map((c) => [c.id, c]));
  for (const c of cur.clips ?? []) if (!pc.has(c.id)) lines.push(`${name}: +clip "${c.name}"`);
  for (const c of prev.clips ?? []) if (!cc.has(c.id)) lines.push(`${name}: -clip "${c.name}"`);
  for (const c of cur.clips ?? []) {
    const p = pc.get(c.id);
    if (!p) continue;
    const pn = noteCount(p);
    const cn = noteCount(c);
    if (pn !== cn) lines.push(`${name}: clip "${c.name}" ${pn} -> ${cn} notes`);
  }

  // Arrangement.
  const pl = (prev.placements ?? []).length;
  const cl = (cur.placements ?? []).length;
  if (pl !== cl) lines.push(`${name}: ${pl} -> ${cl} placements`);
  return lines;
}

function diffParams(label: string, prev: PatchValues, cur: PatchValues): string[] {
  const lines: string[] = [];
  for (const k of Object.keys(cur)) {
    if (prev[k] !== cur[k]) lines.push(`${label}: ${k} ${fmt(prev[k])} -> ${fmt(cur[k])}`);
  }
  return lines;
}

function noteCount(clip: NoteClipData | AudioClipData): number {
  return "notes" in clip ? clip.notes.length : 0;
}

function fmt(v: ParamValue | undefined): string {
  if (v === undefined) return "-";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  return String(v);
}
