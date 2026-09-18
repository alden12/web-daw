/**
 * How long it takes to rebuild a project by replaying its log (DAW-34 stage F).
 *
 * Undo is a rebuild: load a keyframe, replay the entries above it, leave one out. That cost is the
 * gate on whether the rebuild approach survives on a phone or has to grow a per-command inverse fast
 * path, and the only numbers we had were taken on a laptop. So this measures it, and it is a plain
 * function over plain data specifically so the thing you run it on can be the phone in your hand
 * rather than a device farm - see `ui/rebuildBenchPage.ts` for the two-tap version.
 *
 * DOM-free, like everything else in this directory: the replay it measures is the same
 * `replayEntries` the authority, the repository and undo all call, not a stand-in for it.
 */
import { ProjectStore } from "../project/projectStore";
import { replayEntries } from "../commands/replay";
import type { EditCommand, EditEntry } from "../commands/types";
import type { ProjectData } from "../project/types";

/** One measurement, in milliseconds, split the way the work actually divides. */
export interface RebuildSample {
  readonly entries: number;
  /** Turning the stored keyframe back into an object. Pure JSON, and on a big project not small. */
  readonly parseMs: number;
  /** `ProjectStore.load` of that keyframe: building the stores and instruments the project describes. */
  readonly loadMs: number;
  /** Replaying the entries on top, which is the part that scales with how far back you reach. */
  readonly replayMs: number;
  /** What a user waits for: parse + load + replay. */
  readonly totalMs: number;
  /** Size of the serialized keyframe, so the number can be read against the project it describes. */
  readonly keyframeBytes: number;
}

/**
 * How many tracks the synthetic project has. Bounded, and that bound is the whole point: `getTrack`
 * is a linear scan of the track list, so replay is O(edits x tracks). A generator that added a track
 * every thirty edits measured a three-thousand-track project and reported a quadratic curve that no
 * real project would ever walk. A busy arrangement is tens of tracks with thousands of notes each,
 * so that is what this builds.
 */
const BENCH_TRACKS = 40;

/**
 * A synthetic log of `count` edits: a fixed set of tracks with notes piled onto them, which is the
 * shape a real project grows into.
 *
 * Generated rather than recorded because the point is the SHAPE of the cost - entries in, time out -
 * and a generated log is the same on every device, which is what makes two phones comparable.
 */
export function syntheticLog(count: number): EditEntry[] {
  return Array.from({ length: count }, (_, index): EditEntry => {
    const trackIndex = index % BENCH_TRACKS;
    const trackId = `t-${trackIndex}`;
    const command: EditCommand =
      index < BENCH_TRACKS
        ? { type: "createTrack", instrumentType: "subtractive", id: trackId, name: `Track ${trackIndex}` }
        : {
            type: "addNote",
            trackId,
            clipId: `c-${trackId}`,
            note: {
              id: `n-${index}`,
              start: (index % 16) * 0.25,
              length: 0.25,
              pitch: 48 + (index % 24),
              velocity: 0.8,
            },
          };
    return { seq: index, id: `e-${index}`, command, author: "you", time: 0, kind: "edit" };
  });
}

/** The project `entries` produce, as the keyframe a rebuild would start from. */
const keyframeFor = (entries: readonly EditEntry[]): ProjectData => {
  const store = new ProjectStore(false);
  replayEntries(store, entries);
  return store.snapshot();
};

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * Time one rebuild of `entries` edits: the full journey from stored keyframe to usable project.
 *
 * The keyframe is taken from the START of the log and every entry replayed on top, which is the
 * worst case a rebuild ever faces - reaching back as far as the log goes. A real undo usually starts
 * from a much nearer base, so treat this as the ceiling rather than the typical press.
 */
export function measureRebuild(entries: number): RebuildSample {
  const log = syntheticLog(entries);
  const serialized = JSON.stringify(keyframeFor([]));

  const parseStart = now();
  const keyframe = JSON.parse(serialized) as ProjectData;
  const parseMs = now() - parseStart;

  const store = new ProjectStore(false);
  const loadStart = now();
  store.load(keyframe);
  const loadMs = now() - loadStart;

  const replayStart = now();
  replayEntries(store, log);
  const replayMs = now() - replayStart;

  return {
    entries,
    parseMs,
    loadMs,
    replayMs,
    totalMs: parseMs + loadMs + replayMs,
    keyframeBytes: JSON.stringify(store.snapshot()).length,
  };
}

/** The sizes worth knowing: today's window, DAW-38's proposed cap, and the steps between. */
export const BENCH_SIZES = [500, 2000, 10_000, 50_000, 100_000] as const;
