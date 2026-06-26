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

  const before = new Map(from.tracks.map((track) => [track.id, track]));
  const after = new Map(to.tracks.map((track) => [track.id, track]));
  lines.push(...to.tracks.filter((track) => !before.has(track.id)).map((track) => `+ Track "${track.name}"`));
  lines.push(...from.tracks.filter((track) => !after.has(track.id)).map((track) => `- Track "${track.name}"`));
  lines.push(
    ...to.tracks.flatMap((track) => {
      const prev = before.get(track.id);
      return prev ? diffTrack(prev, track) : [];
    }),
  );
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
  const prevEffects = new Map((prev.effects ?? []).map((effect) => [effect.id, effect]));
  const curEffects = new Map((cur.effects ?? []).map((effect) => [effect.id, effect]));
  lines.push(
    ...(cur.effects ?? [])
      .filter((effect) => !prevEffects.has(effect.id))
      .map((effect) => `${name}: +effect ${effect.type}`),
  );
  lines.push(
    ...(prev.effects ?? [])
      .filter((effect) => !curEffects.has(effect.id))
      .map((effect) => `${name}: -effect ${effect.type}`),
  );
  for (const effect of cur.effects ?? []) {
    const was = prevEffects.get(effect.id);
    if (!was) continue;
    if (was.bypassed !== effect.bypassed)
      lines.push(`${name}: ${effect.type} ${effect.bypassed ? "bypassed" : "enabled"}`);
    lines.push(...diffParams(`${name}: ${effect.type}`, was.params, effect.params));
  }

  // Clip pool: add / remove / note-count changes.
  const prevClips = new Map((prev.clips ?? []).map((clip) => [clip.id, clip]));
  const curClips = new Map((cur.clips ?? []).map((clip) => [clip.id, clip]));
  lines.push(
    ...(cur.clips ?? []).filter((clip) => !prevClips.has(clip.id)).map((clip) => `${name}: +clip "${clip.name}"`),
  );
  lines.push(
    ...(prev.clips ?? []).filter((clip) => !curClips.has(clip.id)).map((clip) => `${name}: -clip "${clip.name}"`),
  );
  for (const clip of cur.clips ?? []) {
    const was = prevClips.get(clip.id);
    if (!was) continue;
    const wasNotes = noteCount(was);
    const nowNotes = noteCount(clip);
    if (wasNotes !== nowNotes) lines.push(`${name}: clip "${clip.name}" ${wasNotes} -> ${nowNotes} notes`);
  }

  // Arrangement.
  const prevPlacements = (prev.placements ?? []).length;
  const curPlacements = (cur.placements ?? []).length;
  if (prevPlacements !== curPlacements) lines.push(`${name}: ${prevPlacements} -> ${curPlacements} placements`);
  return lines;
}

function diffParams(label: string, prev: PatchValues, cur: PatchValues): string[] {
  return Object.keys(cur)
    .filter((key) => prev[key] !== cur[key])
    .map((key) => `${label}: ${key} ${fmt(prev[key])} -> ${fmt(cur[key])}`);
}

function noteCount(clip: NoteClipData | AudioClipData): number {
  return "notes" in clip ? clip.notes.length : 0;
}

function fmt(value: ParamValue | undefined): string {
  if (value === undefined) return "-";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toFixed(2));
  return String(value);
}
