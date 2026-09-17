/**
 * DAW-34 stage C: undo by rebuilding the project from a keyframe with the undone edit left out.
 *
 * The important suite here is the cross-check. It runs off the SAME sample table as
 * `invert.test.ts`, so every command whose inverse is known to undo it must also rebuild to the
 * same place. That is what checks the two undo paths against each other while the changeover
 * happens, and what makes deleting the inverses at stage D a safe move rather than a hopeful one.
 */
import { describe, expect, it } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { ProjectRepository } from "../src/audio/projectRepository";
import { MemoryBundleStore } from "../src/audio/bundleStore";
import { invertibleTypes } from "../src/audio/commands/invert";
import { rebuildWithout, replayEntries, isReplayable } from "../src/audio/commands/replay";
import { fingerprintProject } from "../src/audio/project/fingerprint";
import { SAMPLES, seeded, type Sample } from "./support/commandSamples";
import type { InvertibleType } from "../src/audio/commands/invert";

/** An empty project, which is what a log replays onto when nothing has been keyframed yet. */
const emptyProject = () => new ProjectStore(false).snapshot();

describe("rebuildWithout", () => {
  describe.each(invertibleTypes())("%s", (type) => {
    const sample = SAMPLES[type] as Sample<InvertibleType>;

    it("rebuilds to the same project the inverse undoes to", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      const before = fingerprintProject(project.snapshot());

      log.dispatch(sample.command);
      const after = fingerprintProject(project.snapshot());
      // A sample that changes nothing would pass everything below without testing anything.
      expect(after).not.toBe(before);
      const seq = log.getEntries().at(-1)!.seq;

      const rebuilt = rebuildWithout(emptyProject(), -1, log.getEntries(), new Set([seq]));
      expect(fingerprintProject(rebuilt)).toBe(before);
    });

    it("rebuilds to the live project when nothing is excluded", () => {
      const { project, log } = seeded();
      for (const command of sample.setup) log.dispatch(command);
      log.resetCoalescing();
      log.dispatch(sample.command);

      const rebuilt = rebuildWithout(emptyProject(), -1, log.getEntries(), new Set());
      expect(fingerprintProject(rebuilt)).toBe(fingerprintProject(project.snapshot()));
    });
  });
});

describe("replayEntries", () => {
  it("skips what is not a forward edit", () => {
    expect(isReplayable(undefined)).toBe(true); // written before `kind` existed
    expect(isReplayable("edit")).toBe(true);
    expect(isReplayable("note")).toBe(false);
    expect(isReplayable("undo")).toBe(false);
    expect(isReplayable("redo")).toBe(false);
    expect(isReplayable("something-new")).toBe(false);
  });

  it("leaves entries at or below the base alone, because the base already reflects them", () => {
    const { project, log } = seeded();
    log.dispatch({ type: "setTempo", bpm: 140 });
    const seq = log.getEntries().at(-1)!.seq;

    const onto = new ProjectStore(false);
    onto.load(project.snapshot());
    replayEntries(onto, log.getEntries(), { above: seq });
    expect(fingerprintProject(onto.snapshot())).toBe(fingerprintProject(project.snapshot()));
  });
});

describe("ProjectRepository.rebuildExcluding", () => {
  const repoWith = () => new ProjectRepository(new MemoryBundleStore(), "p-rebuild");

  it("rebuilds from the retained keyframe, end to end", async () => {
    const repo = repoWith();
    const { project, log } = seeded();
    // What creating a project does: keyframe the seed state, which anchors the ring at its seq.
    await repo.save(project.snapshot(), log.getEntries(), log.getNotes());
    const before = fingerprintProject(project.snapshot());

    log.dispatch({ type: "setTempo", bpm: 155 });
    const seq = log.getEntries().at(-1)!.seq;

    const rebuilt = await repo.rebuildExcluding(new Set([seq]), log.getEntries(), seq);
    expect(rebuilt).not.toBeNull();
    expect(fingerprintProject(rebuilt!)).toBe(before);
  });

  it("refuses rather than guesses when the ring does not reach back", async () => {
    const repo = repoWith();
    const { log } = seeded();
    // No keyframe written at all, so there is no base below the edit.
    expect(await repo.rebuildExcluding(new Set([0]), log.getEntries(), 10)).toBeNull();
  });

  it("has nothing to do when nothing is excluded", async () => {
    const repo = repoWith();
    expect(await repo.rebuildExcluding(new Set(), [], 10)).toBeNull();
  });
});
