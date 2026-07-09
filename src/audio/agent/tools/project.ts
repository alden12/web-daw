/**
 * Project-wide tools: tempo, arrangement length + loop, groove, the sample library, and
 * transport. Tempo/length/loop/groove dispatch as "agent"; transport is a live Scheduler
 * call (playback is not a durable edit). Samples and grooves are read from the catalogs.
 */
import { z } from "zod";
import type { AgentTool } from "../types";
import { defineTool, type ToolContext } from "./factory";
import { GROOVES, grooveById } from "../../grooves/catalog";
import { BUILTIN_SAMPLES, assetRef, builtinRef } from "../../samples/catalog";

export function projectTools(ctx: ToolContext): AgentTool[] {
  const { projectStore, dispatch, scheduler } = ctx;

  return [
    defineTool({
      name: "set_tempo",
      description: "Set the project tempo in BPM.",
      schema: z.object({ bpm: z.number().min(20).max(300) }),
      run: ({ bpm }) => {
        dispatch({ type: "setTempo", bpm }, "agent");
        return { ok: true, bpm };
      },
    }),

    defineTool({
      name: "set_length",
      description: "Set the arrangement length in beats (4 beats = 1 bar).",
      schema: z.object({ lengthBeats: z.number().positive() }),
      run: ({ lengthBeats }) => {
        dispatch({ type: "setLength", lengthBeats }, "agent");
        return { ok: true, lengthBeats };
      },
    }),

    defineTool({
      name: "set_loop_start",
      description: "Set the loop/playback start point in beats.",
      schema: z.object({ beats: z.number().min(0) }),
      run: ({ beats }) => {
        dispatch({ type: "setLoopStart", beats }, "agent");
        return { ok: true, beats };
      },
    }),

    defineTool({
      name: "list_grooves",
      description: "List the available grooves (swing/feel presets) and the current project groove.",
      schema: z.object({}),
      run: () => ({
        current: projectStore.getGroove(),
        grooves: GROOVES.map((groove) => ({ id: groove.id, name: groove.name })),
      }),
    }),

    defineTool({
      name: "set_groove",
      description: "Set the project groove (a swing/feel preset) and/or its amount (0..1). Omit a field to leave it.",
      schema: z.object({ groove: z.string().optional(), amount: z.number().min(0).max(1).optional() }),
      run: ({ groove, amount }) => {
        if (groove !== undefined && grooveById(groove).id !== groove) {
          throw new Error(`Unknown groove "${groove}". Valid: ${GROOVES.map((entry) => entry.id).join(", ")}.`);
        }
        dispatch({ type: "setGroove", grooveId: groove, amount }, "agent");
        return { ok: true, groove: groove ?? null, amount: amount ?? null };
      },
    }),

    defineTool({
      name: "list_samples",
      description: "List sample references usable on a Sampler track: built-in kit + the project's imported samples.",
      schema: z.object({}),
      run: () => ({
        builtin: BUILTIN_SAMPLES.map((sample) => ({ ref: builtinRef(sample.id), name: sample.name })),
        project: projectStore.getSamples().map((asset) => ({ ref: assetRef(asset.id), name: asset.name })),
      }),
    }),

    defineTool({
      name: "play",
      description:
        "Start playback from the loop start (audition the arrangement). No-op until the user has started audio.",
      schema: z.object({}),
      run: () => {
        scheduler.play();
        return { ok: true, playing: scheduler.isPlaying };
      },
    }),

    defineTool({
      name: "stop",
      description: "Stop playback.",
      schema: z.object({}),
      run: () => {
        scheduler.stop();
        return { ok: true, playing: scheduler.isPlaying };
      },
    }),
  ];
}
