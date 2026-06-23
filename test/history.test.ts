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
});
