/**
 * The safety net for DAW-34. A wrong inverse silently corrupts a project, where a snapshot simply
 * cannot be wrong, so every inverter has to earn its place here before it is registered:
 *
 *  - apply a command, undo it, and the project is byte-identical to before;
 *  - redo it, and the project is byte-identical to after;
 *  - and the sample table is keyed by `InvertibleType`, so registering an inverter without a sample
 *    command is a compile error rather than an untested path.
 *
 * Samples run through `EditLog.dispatch`/`undo`/`redo` rather than calling `invert` directly, so the
 * checkpoint union and the coalescing path are covered too.
 */
import { describe, it, expect } from "vitest";
import { applyEdit } from "../src/audio/commands/applyEdit";
import { EditLog } from "../src/audio/commands/editLog";
import {
  authorshipBefore,
  invert,
  invertibleTypes,
  restoreAuthorship,
  type InvertibleType,
} from "../src/audio/commands/invert";
import type { EditCommand } from "../src/audio/commands/types";
import { paramKey } from "../src/audio/commands/authorship";
import { conflictKeys, keysOverlap, undoConflictKeys } from "../src/audio/sync/conflict";
import { fingerprintProject } from "../src/audio/project/fingerprint";
import { ProjectStore } from "../src/audio/project/projectStore";
import { normalizeCommand } from "../src/audio/commands/normalize";
import { SAMPLES, seeded, type Sample } from "./support/commandSamples";

/**
 * Commands that COPY existing state into a new object. They are excluded from the second position in
 * the out-of-order test below, because "equals a world where `first` never happened" is the wrong
 * standard for them: a fork captures the clip as it stood, and undoing an earlier edit rightly does
 * not reach into a copy someone has already taken. Nothing is lost either way, which is the property
 * the gate actually has to protect.
 *
 * Not a general escape hatch. A command that *overwrites* what an intervening edit wrote is a real
 * conflict and stays in the test, which is what `undoConflictKeys` exists to catch.
 */
/**
 * There was a `CONTAINMENT_GAP` exclusion here, for the one container removal the gate could not
 * reason about. `removeTrack` was the only command in it, and it is no longer inverted (see
 * `invert.ts`), so there is nothing left to exclude.
 *
 * The gap itself is still real, and still open as DAW-34.1: a track's contents are keyed by their
 * own ids (`effect:fx-1`, `note:n-1`), not scoped to the track, so no `track:` prefix reaches them,
 * and their authorship stamps outlive the track with or without undo.
 */

const CAPTURES_STATE = new Set<EditCommand["type"]>([
  "addClip",
  "pasteClip",
  "createTrackFromPatch",
  // These bake a beat length computed from the tempo of the moment. Same reasoning: undoing an
  // earlier tempo change does not reach back into a length already chosen (DAW-35).
  "addAudioTrack",
  "addAudioClip",
  "addPlacement",
]);

/** A minimal custom instrument and effect, as data - enough for the add/remove pair to round trip. */
describe("invert", () => {
  it("has a sample command for every registered inverter", () => {
    // The table is keyed by InvertibleType so this cannot actually fail to compile-and-pass; it is
    // here to name the invariant, and to fail loudly if the table is ever widened by hand.
    expect(Object.keys(SAMPLES).sort()).toEqual(invertibleTypes().sort());
  });

  describe.each(invertibleTypes())("%s", (type) => {
    const sample = SAMPLES[type] as Sample<InvertibleType>;

    it("has an inverse, so it takes the cheap checkpoint", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const inverse = invert(project, sample.command);
      expect(inverse).not.toBeNull();
      expect(inverse?.length).toBeGreaterThan(0);
    });

    it("undoes to a byte-identical project, and redoes back", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const before = fingerprintProject(project.snapshot());

      log.dispatch(sample.command);
      const after = fingerprintProject(project.snapshot());
      // A sample that changes nothing would pass every assertion below without testing anything.
      expect(after).not.toBe(before);

      log.undo();
      expect(fingerprintProject(project.snapshot())).toBe(before);

      log.redo();
      expect(fingerprintProject(project.snapshot())).toBe(after);
    });

    it("survives a round trip through the persisted stack", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const before = fingerprintProject(project.snapshot());
      log.dispatch(sample.command);
      const after = fingerprintProject(project.snapshot());

      // What a reload does: the same project state, plus the packed stack written beside it.
      const packed = JSON.parse(JSON.stringify(log.getCheckpoints()));
      const reloaded = new ProjectStore(false);
      reloaded.load(JSON.parse(JSON.stringify(project.snapshot())));
      const reloadedLog = new EditLog(reloaded);
      reloadedLog.restoreCheckpoints(packed);

      expect(fingerprintProject(reloaded.snapshot())).toBe(after);
      reloadedLog.undo();
      expect(fingerprintProject(reloaded.snapshot())).toBe(before);
      reloadedLog.redo();
      expect(fingerprintProject(reloaded.snapshot())).toBe(after);
    });
  });

  /**
   * A tempo change rescales audio placements, because audio does not follow the tempo yet (DAW-35).
   * The length is in beats but means a duration in seconds, so the seconds are what must survive.
   */
  it("a tempo change keeps an audio placement the same length in seconds, and undo puts it back", () => {
    const { project, log } = seeded();
    const lengthOf = (placementId: string) =>
      project
        .getTracks()
        .find((track) => track.id === "at-1")
        ?.placements.find((p) => p.id === placementId)?.length ?? 0;

    // Trimmed by hand first, so this also proves the rescale is a ratio and not a recompute from
    // `durationSec` - a recompute would silently undo the user's trim.
    log.dispatch({ type: "resizePlacement", trackId: "at-1", placementId: "ap-1", length: 3 });
    log.resetCoalescing();
    const secondsBefore = 3 / (project.tempo / 60);

    log.dispatch({ type: "setTempo", bpm: 240 });
    expect(lengthOf("ap-1") / (project.tempo / 60)).toBeCloseTo(secondsBefore, 10);
    expect(lengthOf("ap-1")).not.toBe(3);

    log.undo();
    expect(project.tempo).toBe(120);
    expect(lengthOf("ap-1")).toBe(3); // exactly, not approximately: the inverse restores it outright
  });

  /**
   * An inverse checkpoint applies commands rather than restoring a snapshot, and `applyEdit` stamps
   * authorship as it goes - so without the captured `authors` an undo would re-attribute the object
   * to whoever undid it. The per-sample tests above cannot catch a missing capture because they are
   * single-author; this one edits as "claude" and undoes as "you".
   */
  it("restores the authorship the edit stamped over, across a reload", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 1200 }, "claude");
    log.resetCoalescing();
    log.dispatch({ type: "setParam", trackId: "t-1", id: "filter.cutoff", value: 3400 }, "you");
    expect(project.authorOf(paramKey("t-1", "filter.cutoff"))).toBe("you");

    // The stack has to carry the stamp through JSON, not just hold it in memory.
    const packed = JSON.parse(JSON.stringify(log.getCheckpoints()));
    const reloaded = new ProjectStore(false);
    reloaded.load(JSON.parse(JSON.stringify(project.snapshot())));
    const reloadedLog = new EditLog(reloaded);
    reloadedLog.restoreCheckpoints(packed);

    reloadedLog.undo();
    // Alden's call: the stamp names whoever authored the value you can see, so undoing back to
    // Claude's value hands the tint back to Claude rather than keeping it on the undoer.
    expect(reloaded.authorOf(paramKey("t-1", "filter.cutoff"))).toBe("claude");
  });

  /**
   * The gate that makes out-of-order and author-scoped undo safe (DAW-34) trusts `conflictKeys`:
   * non-overlapping keys are taken as a licence to apply an inverse out of order. Assert the claim
   * the gate actually rests on, which is narrower than "the two commands commute": taking `first`
   * back after `second` has landed must give the same project as never having done `first` at all.
   *
   * The difference matters. `createTrack` then `createAudioTrack` genuinely does not commute (the
   * track list is ordered), but undoing the first is still exact, because its inverse removes by id
   * and does not care what else arrived. Testing forward commutativity would have failed that pair
   * and pushed us to key it as a conflict for no reason.
   *
   * Compared on a *canonical* snapshot: `applyEdit` writes the authorship record as it goes, and
   * key order there is not part of the project's meaning.
   */
  it("an inverse still undoes its command after a disjoint edit lands on top", () => {
    /** JSON with object keys sorted, so insertion order stops counting as a difference. Array order
     *  is left alone: a track list and a note list mean something in order. */
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, canonical(nested)]),
            )
          : value;

    const commands = invertibleTypes().map((type) => (SAMPLES[type] as Sample<InvertibleType>).command);
    const pairs = commands.flatMap((first) =>
      commands
        .filter((second) => second.type !== first.type)
        .filter((second) => !CAPTURES_STATE.has(second.type))
        .map((second) => [first, second] as const),
    );
    let checked = 0;

    for (const [rawFirst, rawSecond] of pairs) {
      // Do `first`, let `second` land on top, then take `first` back the way `EditLog.rewind` does.
      // Both are normalised where a dispatch would have normalised them (DAW-36), and are FIXED from
      // there on - that is what a log entry is, and replaying one must not re-resolve it against
      // whatever state it happens to meet.
      const { project: outOfOrder } = seeded();
      const first = normalizeCommand(outOfOrder, rawFirst);
      const inverse = invert(outOfOrder, first);
      if (inverse === null) continue; // declined an inverse, so it takes a snapshot and the gate never sees it
      const authors = authorshipBefore(outOfOrder, [first, ...inverse]);
      applyEdit(outOfOrder, first, "you");
      const second = normalizeCommand(outOfOrder, rawSecond);
      // The gate's own question, asked with the gate's own key function: only pairs it would let
      // through are claims we have to honour.
      if (keysOverlap(undoConflictKeys(first, inverse), conflictKeys(second))) continue;
      checked++;
      applyEdit(outOfOrder, second, "you");
      for (const command of inverse) applyEdit(outOfOrder, command, "you");
      restoreAuthorship(outOfOrder, authors);

      // What the project would be if `first` had never happened.
      const { project: never } = seeded();
      applyEdit(never, second, "you");

      expect(canonical(outOfOrder.snapshot()), `${first.type} then ${second.type}`).toEqual(
        canonical(never.snapshot()),
      );
    }
    expect(checked).toBeGreaterThan(0);
  });
});
