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
});
