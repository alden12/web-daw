/**
 * The agent's tools - the whole of what it can do to a project. Read tools query the
 * live `projectStore`; edit tools go through `dispatch(command, "claude")`, the exact
 * path the UI and MCP use, so the agent inherits undo, the activity feed, history, and
 * engine reconciliation for free. Tool argument sets that reference instruments or
 * parameters are validated against the catalogs (never a hardcoded list), matching how
 * the MCP server discovers its action space. Adding a tool is one `defineTool` entry.
 *
 * Every tool takes and returns plain serializable data and returns a Promise (invariant:
 * a tool can later be backed by a Worker actor without touching the loop). See
 * docs/AGENT.md.
 */
import { z } from "zod";
import type { AgentTool } from "./types";
import type { ProjectStore, InstrumentTrack, Track } from "../project/projectStore";
import type { Dispatch } from "../commands/types";
import type { NoteEvent } from "../sequencer/types";
import type { ParamSpec, ParamValue } from "../params/types";
import { newNoteId, newTrackId } from "../commands/ids";
import { hasInstrument, instrumentSchema, pickableInstrumentInfos } from "../instruments/catalog";
import { validateParam } from "../params/validate";

export interface AgentToolDeps {
  projectStore: ProjectStore;
  dispatch: Dispatch;
}

/** Build a tool from a zod schema: the schema both validates the model's arguments and
 *  (via z.toJSONSchema) produces the provider-facing parameter schema. */
function defineTool<Schema extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: Schema;
  run: (args: z.infer<Schema>) => unknown | Promise<unknown>;
}): AgentTool {
  const jsonSchema = z.toJSONSchema(def.schema) as Record<string, unknown>;
  delete jsonSchema.$schema; // providers want a bare parameter schema
  return {
    name: def.name,
    description: def.description,
    jsonSchema,
    async run(rawArgs: unknown) {
      const parsed = def.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`Invalid arguments: ${detail}`);
      }
      return def.run(parsed.data);
    },
  };
}

const noteInput = z.object({
  pitch: z.number().int().min(0).max(127).describe("MIDI note, C4 = 60"),
  start: z.number().min(0).describe("onset in beats from the clip start (4 beats = 1 bar)"),
  length: z.number().min(0).optional().describe("duration in beats (default 1)"),
  velocity: z.number().min(0).max(1).optional().describe("0..1 (default 0.8)"),
});

export function createAgentTools(deps: AgentToolDeps): AgentTool[] {
  const { projectStore, dispatch } = deps;

  const resolveTrack = (trackId?: string): Track => {
    const id = trackId ?? projectStore.selectedId ?? undefined;
    if (!id) throw new Error("No track given and none is selected. Call list_tracks and pass a track id.");
    const track = projectStore.getTrack(id);
    if (!track) throw new Error(`No track with id "${id}". Call list_tracks for valid ids.`);
    return track;
  };
  const resolveInstrumentTrack = (trackId?: string): InstrumentTrack => {
    const track = resolveTrack(trackId);
    if (track.kind !== "instrument") throw new Error(`Track "${track.id}" is an audio track, not an instrument track.`);
    return track;
  };

  return [
    defineTool({
      name: "list_tracks",
      description:
        "List the project's tracks (id, name, kind, instrument) plus tempo, length, the selected track, and the instrument palette you can create from. Call this first to learn track ids.",
      schema: z.object({}),
      run: () => ({
        tempoBpm: projectStore.tempo,
        lengthBeats: projectStore.length,
        selectedTrackId: projectStore.selectedId,
        instruments: pickableInstrumentInfos().map((info) => ({
          type: info.type,
          label: info.label,
          family: info.family,
        })),
        tracks: projectStore.getTracks().map((track) => ({
          id: track.id,
          name: track.name,
          kind: track.kind,
          instrument: track.kind === "instrument" ? track.instrumentType : undefined,
          muted: track.muted,
          solo: track.solo,
          clips: track.clips.length,
        })),
      }),
    }),

    defineTool({
      name: "list_notes",
      description: "List the note events in a track's clip (defaults to the selected track and its active clip).",
      schema: z.object({ track: z.string().optional(), clip: z.string().optional() }),
      run: ({ track, clip }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const clipStore = projectStore.getClipStore(instrumentTrack.id, clip);
        if (!clipStore) throw new Error(`Track "${instrumentTrack.id}" has no clip to read.`);
        const { notes, lengthBeats } = clipStore.getClip();
        return {
          trackId: instrumentTrack.id,
          lengthBeats,
          notes: notes.map((note) => ({
            id: note.id,
            pitch: note.pitch,
            start: note.start,
            length: note.length,
            velocity: note.velocity,
          })),
        };
      },
    }),

    defineTool({
      name: "list_parameters",
      description:
        "List an instrument track's parameters with their current values and ranges (defaults to the selected track).",
      schema: z.object({ track: z.string().optional() }),
      run: ({ track }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const schema = instrumentSchema(instrumentTrack.instrumentType);
        return {
          trackId: instrumentTrack.id,
          instrument: instrumentTrack.instrumentType,
          parameters: schema.map((spec) => describeParam(spec, instrumentTrack.params.get(spec.id))),
        };
      },
    }),

    defineTool({
      name: "create_track",
      description: "Create a new instrument track. `instrument` must be one of the palette types from list_tracks.",
      schema: z.object({ instrument: z.string(), name: z.string().optional() }),
      run: ({ instrument, name }) => {
        if (!hasInstrument(instrument)) {
          throw new Error(
            `Unknown instrument "${instrument}". Valid: ${pickableInstrumentInfos()
              .map((info) => info.type)
              .join(", ")}.`,
          );
        }
        const id = newTrackId();
        dispatch({ type: "createTrack", instrumentType: instrument, name, id }, "claude");
        return { ok: true, trackId: id, instrument, name: name ?? null };
      },
    }),

    defineTool({
      name: "add_notes",
      description:
        "Add one or more notes to a track's clip in a single edit (defaults to the selected track / active clip). Times are in beats.",
      schema: z.object({
        track: z.string().optional(),
        clip: z.string().optional(),
        notes: z.array(noteInput).min(1).max(512),
      }),
      run: ({ track, clip, notes }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        const built: NoteEvent[] = notes.map((note) => ({
          id: newNoteId(),
          pitch: note.pitch,
          start: note.start,
          length: note.length ?? 1,
          velocity: note.velocity ?? 0.8,
        }));
        dispatch({ type: "addNotes", trackId: instrumentTrack.id, clipId: clip, notes: built }, "claude");
        return { ok: true, added: built.length, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "remove_notes",
      description: "Remove notes by id from a track's clip (get ids from list_notes).",
      schema: z.object({ track: z.string().optional(), clip: z.string().optional(), ids: z.array(z.string()).min(1) }),
      run: ({ track, clip, ids }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        dispatch({ type: "removeNotes", trackId: instrumentTrack.id, clipId: clip, ids }, "claude");
        return { ok: true, removed: ids.length, trackId: instrumentTrack.id };
      },
    }),

    defineTool({
      name: "set_parameter",
      description:
        "Set an instrument parameter by id (get ids/ranges from list_parameters). Defaults to the selected track.",
      schema: z.object({
        track: z.string().optional(),
        id: z.string(),
        value: z.union([z.number(), z.string(), z.boolean()]),
      }),
      run: ({ track, id, value }) => {
        const instrumentTrack = resolveInstrumentTrack(track);
        let spec: ParamSpec;
        try {
          spec = instrumentTrack.params.spec(id);
        } catch {
          throw new Error(
            `Unknown parameter "${id}" on ${instrumentTrack.instrumentType}. Call list_parameters for valid ids.`,
          );
        }
        const error = validateParam(spec, value);
        if (error) throw new Error(error);
        dispatch({ type: "setParam", trackId: instrumentTrack.id, id, value }, "claude");
        return { ok: true, trackId: instrumentTrack.id, id, value };
      },
    }),

    defineTool({
      name: "rename_track",
      description: "Rename a track (defaults to the selected track).",
      schema: z.object({ track: z.string().optional(), name: z.string().min(1) }),
      run: ({ track, name }) => {
        const resolved = resolveTrack(track);
        dispatch({ type: "setTrack", trackId: resolved.id, name }, "claude");
        return { ok: true, trackId: resolved.id, name };
      },
    }),

    defineTool({
      name: "set_tempo",
      description: "Set the project tempo in BPM.",
      schema: z.object({ bpm: z.number().min(20).max(300) }),
      run: ({ bpm }) => {
        dispatch({ type: "setTempo", bpm }, "claude");
        return { ok: true, bpm };
      },
    }),
  ];
}

function describeParam(spec: ParamSpec, value: ParamValue) {
  const base = { id: spec.id, label: spec.label, kind: spec.kind, value };
  if (spec.kind === "number") {
    return { ...base, min: spec.min, max: spec.max, unit: spec.unit, step: spec.step, format: spec.format };
  }
  if (spec.kind === "enum") return { ...base, options: spec.options };
  return base;
}
