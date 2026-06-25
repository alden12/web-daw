import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectStore } from '../src/audio/project/projectStore';
import { EditLog } from '../src/audio/commands/editLog';
import { VersionStore } from '../src/audio/commands/history';
import { ProjectRepository } from '../src/audio/projectRepository';
import { MemoryBundleStore } from '../src/audio/bundleStore';

/** A project + log + a fresh in-memory repository, sharing one bundle store. */
function setup(repo = new ProjectRepository(new MemoryBundleStore(), { loadLegacy: () => null })) {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  return { project, log, repo };
}

describe('VersionStore (commit DAG)', () => {
  afterEach(() => vi.useRealTimers());

  it('commits uncommitted edits and chains them by parent (newest first)', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    const a = await vs.commit('first', 'you');
    expect(a?.parent).toBeNull();

    log.dispatch({ type: 'setTempo', bpm: 90 }, 'claude');
    const b = await vs.commit('second', 'claude');
    expect(b?.parent).toBe(a!.id);
    expect(b?.author).toBe('claude');

    const hist = await vs.history();
    expect(hist.map((c) => c.message)).toEqual(['second', 'first']);
  });

  it('is a no-op when there is nothing uncommitted', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-1' });
    expect(await vs.commit('x')).toBeTruthy();
    expect(await vs.commit('again')).toBeNull();
  });

  it('auto-checkpoints a burst of edits after the debounce', async () => {
    vi.useFakeTimers();
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    const dispose = vs.attach();

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    log.dispatch({ type: 'setTempo', bpm: 110 });
    await vi.runAllTimersAsync(); // fire the debounced checkpoint + flush its writes
    dispose();

    const hist = await vs.history();
    expect(hist).toHaveLength(1);
    expect(hist[0].auto).toBe(true);
    expect(hist[0].entryCount).toBe(2); // both edits in one checkpoint
  });

  it('persists the DAG: a new store on the same repo reads the history', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    await vs.commit('only', 'you');

    const vs2 = new VersionStore(project, log, repo); // simulate reload
    await vs2.load();
    expect((await vs2.history()).map((c) => c.message)).toEqual(['only']);
    // lastCommittedSeq restored -> no phantom re-commit of already-committed edits.
    expect(await vs2.commit('noop')).toBeNull();
  });

  it('starts history from the current point when loading a project with no commits', async () => {
    const { project, log, repo } = setup();
    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-1' }); // pre-existing working edit
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    expect(await vs.commit('nothing new')).toBeNull(); // not retro-committed
    log.dispatch({ type: 'setTempo', bpm: 100 });
    expect(await vs.commit('forward')).toBeTruthy();
  });

  it('treats a commit as a coalescing boundary (same-target edits after it are new)', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // Same-target edits in one tick coalesce; commit, then edit the same target
    // again in the same tick - it must NOT fold into the committed entry.
    log.dispatch({ type: 'setTempo', bpm: 90 });
    expect(await vs.commit('v1')).toBeTruthy();
    log.dispatch({ type: 'setTempo', bpm: 91 });
    expect(await vs.commit('v2')).toBeTruthy(); // would be null without the boundary reset
  });

  it('reverts to an earlier commit and records it as a new HEAD', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    const v1 = await vs.commit('v1', 'you'); // one track
    expect(v1).toBeTruthy();

    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-2' }); // distinct, non-coalescing edit
    const v2 = await vs.commit('v2', 'you'); // two tracks
    expect(v2).toBeTruthy();
    expect(project.getTrack('t-2')).toBeTruthy();

    const rev = await vs.revertTo(v1!.id, 'you');
    expect(project.getTrack('t-2')).toBeUndefined(); // live state jumped back to v1
    expect(project.getTrack('t-1')).toBeTruthy();
    // History is append-only: v1, v2, then the revert on top (newest first).
    const hist = await vs.history();
    expect(hist[0].id).toBe(rev!.id);
    expect(hist.map((c) => c.message)).toEqual(['Revert to "v1"', 'v2', 'v1']);
  });

  it('diffs two commits in musical terms', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    const a = await vs.commit('a', 'you');
    log.dispatch({ type: 'setTempo', bpm: 96 });
    const b = await vs.commit('b', 'you');

    expect(await vs.diff(a!.id, b!.id)).toContain('Tempo 120 -> 96 BPM');
  });

  // --- keyframe + delta storage ---------------------------------------------

  it('stores deltas after the root keyframe and replays them exactly', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // A run of distinct forward edits, one commit each. Only the first is the root
    // keyframe; the rest are deltas (no stored snapshot).
    const ids: string[] = [];
    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    ids.push((await vs.commit('c0', 'you'))!.id);
    for (let i = 1; i <= 5; i++) {
      log.dispatch({ type: 'setTempo', bpm: 100 + i });
      log.dispatch({ type: 'addNote', trackId: 't-1', note: { id: `n-${i}`, pitch: 60 + i, start: i, length: 1, velocity: 0.8 } });
      ids.push((await vs.commit(`c${i}`, 'you'))!.id);
    }

    const root = await repo.readCommit(ids[0]);
    const second = await repo.readCommit(ids[1]);
    const last = await repo.readCommit(ids[ids.length - 1]);
    expect(root!.snapshot).toBeTruthy(); // root is a keyframe
    expect(second!.snapshot).toBeUndefined(); // a delta - no stored snapshot
    expect(last!.snapshot).toBeUndefined();

    // Reverting to the HEAD delta must reconstruct the exact live state.
    const live = project.snapshot();
    await vs.revertTo(ids[ids.length - 1], 'you');
    expect(project.snapshot()).toEqual(live);
    expect(project.getTrack('t-1')).toBeTruthy();
    expect(project.tempo).toBe(105);
  });

  it('writes a keyframe on the cadence so long histories stay replayable', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    // 20 commits: root (keyframe) + 19 more; a keyframe falls on the cadence.
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      log.dispatch({ type: 'setTempo', bpm: 60 + i });
      ids.push((await vs.commit(`v${i}`, 'you'))!.id);
    }
    const haveSnapshot = await Promise.all(ids.map(async (id) => !!(await repo.readCommit(id))!.snapshot));
    const keyframeCount = haveSnapshot.filter(Boolean).length;
    expect(keyframeCount).toBeGreaterThanOrEqual(2); // root + at least one cadence keyframe
    // Every commit still materializes to the right tempo (spot-check a late delta).
    expect(await vs.diff(ids[18], ids[19])).toContain('Tempo 78 -> 79 BPM');
  });

  it('forces a keyframe on a commit that contains undo/redo (cannot replay forward)', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();

    log.dispatch({ type: 'createTrack', instrumentType: 'subtractive', id: 't-1' });
    await vs.commit('base', 'you'); // root keyframe

    log.dispatch({ type: 'createTrack', instrumentType: 'fm', id: 't-2' });
    log.undo(); // removes t-2; this entry restores a snapshot, not a forward edit
    const c = await vs.commit('with undo', 'you');

    const stored = await repo.readCommit(c!.id);
    expect(stored!.snapshot).toBeTruthy(); // forced keyframe
    // And the materialized state is correct: t-2 was undone away.
    await vs.revertTo(c!.id, 'you');
    expect(project.getTrack('t-2')).toBeUndefined();
    expect(project.getTrack('t-1')).toBeTruthy();
  });

  it('recomputes the keyframe distance on reload so cadence continues correctly', async () => {
    const { project, log, repo } = setup();
    const vs = new VersionStore(project, log, repo);
    await vs.load();
    for (let i = 0; i < 5; i++) {
      log.dispatch({ type: 'setTempo', bpm: 70 + i });
      await vs.commit(`v${i}`, 'you');
    }

    // Reload mid-cadence; new commits must still materialize correctly.
    const vs2 = new VersionStore(project, log, repo);
    await vs2.load();
    log.dispatch({ type: 'setTempo', bpm: 90 });
    const head = await vs2.commit('after reload', 'you');
    const hist = await vs2.history();
    expect(hist[0].id).toBe(head!.id);
    expect(await vs2.diff(hist[1].id, head!.id)).toContain('Tempo 74 -> 90 BPM');
  });
});
