/**
 * The patch library: a user's saved instrument *patches* - an instrument type plus
 * its parameter values and effect chain, captured as a named, reusable preset that
 * shows up in the library tree like a built-in instrument. Patches are **global**
 * (shared across all projects), so they live in localStorage rather than the project
 * bundle. This module is the single store: pure data + localStorage + a subscribe
 * seam (no DOM, no React), mirroring how the rest of the audio layer is shaped.
 *
 * A patch stores effects *without* instance ids - ids are per-track and are minted
 * fresh when a patch is applied (see `createTrackFromPatch`), so the same patch can
 * be dropped onto many tracks. Applying a patch is one authored edit, so it is
 * undoable, two-voice, and replayable like any other.
 */
import type { Author } from "../commands/types";
import type { PatchValues } from "../params/types";

/** One effect in a saved patch: its type, bypass state, and parameter values. */
export interface PatchEffect {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** One MIDI device in a saved patch (same idless shape as PatchEffect). */
export interface PatchMidiDevice {
  type: string;
  bypassed?: boolean;
  params: PatchValues;
}

/** A saved instrument preset: instrument + params + MIDI-device + effect chains, named by the user. */
export interface Patch {
  id: string;
  name: string;
  author: Author;
  instrumentType: string;
  params: PatchValues;
  effects: PatchEffect[];
  /** MIDI-device chain (note transforms). Optional: patches saved before this default to none. */
  midiDevices?: PatchMidiDevice[];
  createdAt: number;
  /** True for a shipped factory preset (read-only, not in localStorage - see factory.ts). */
  builtin?: boolean;
  /** Optional grouping label for the library (factory presets set this, e.g. "Bass"). */
  category?: string;
}

const STORAGE_KEY = "web-daw:patches:v1";
const listeners = new Set<() => void>();

function store(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // localStorage can throw (privacy mode); degrade to an empty library
  }
}

/** All saved patches, newest first. Returns [] when storage is unavailable or empty. */
export function listPatches(): Patch[] {
  const raw = store()?.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Patch[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: Patch[]): void {
  store()?.setItem(STORAGE_KEY, JSON.stringify(list));
  for (const listener of listeners) listener();
}

/** Insert or replace a patch (by id), keeping the list newest-first. */
export function savePatch(patch: Patch): void {
  write([patch, ...listPatches().filter((entry) => entry.id !== patch.id)]);
}

/** Remove a patch by id. */
export function removePatch(id: string): void {
  write(listPatches().filter((patch) => patch.id !== id));
}

/** Subscribe to library changes (save/remove). Returns an unsubscribe fn. */
export function subscribePatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A fresh patch id. */
export function newPatchId(): string {
  return `pt-${crypto.randomUUID().slice(0, 8)}`;
}
