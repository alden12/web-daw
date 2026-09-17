/**
 * DAW-8.13: a drag is one edit.
 *
 * Coalescing used to be purely time-windowed, so a drag that paused - which a finger on a resize
 * handle does constantly - crossed the window and started a fresh entry. One slow trim became a
 * dozen undo steps, a dozen feed rows, and a row per frame at the authority. A drag now says where
 * it begins and ends, and the forward waits for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectStore } from "../src/audio/project/projectStore";
import { EditLog } from "../src/audio/commands/editLog";
import { beginDragGesture, endDragGesture, setDragGestureScope } from "../src/ui/dragGesture";
import type { EditCommand } from "../src/audio/commands/types";

const tempo = (bpm: number): EditCommand => ({ type: "setTempo", bpm });
const track = (id: string): EditCommand => ({ type: "createTrack", instrumentType: "subtractive", id });

function seeded() {
  const project = new ProjectStore(false);
  const log = new EditLog(project);
  const forwarded: EditCommand[] = [];
  log.setRemote((edit) => forwarded.push(edit.command));
  /** Just the tempo entries, so the seed edits a case needs do not have to be counted around. */
  const tempoEntries = () => log.getEntries().filter((entry) => entry.command.type === "setTempo");
  return { project, log, forwarded, tempoEntries };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setDragGestureScope(null);
});

describe("a gesture bounds an entry", () => {
  it("folds a whole drag into one entry, however long the drag takes", () => {
    const { log, tempoEntries } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    vi.advanceTimersByTime(3000); // a pause far past the coalesce window, mid-drag
    log.dispatch(tempo(130));
    vi.advanceTimersByTime(3000);
    log.dispatch(tempo(140));
    log.endGesture();

    expect(tempoEntries()).toHaveLength(1);
    expect(tempoEntries()[0]?.command).toMatchObject({ bpm: 140 });
  });

  // The bug, stated as the behaviour without a gesture: this is what every drag used to do.
  it("still splits on the window when nothing says where the drag is", () => {
    const { log, tempoEntries } = seeded();
    log.dispatch(tempo(120));
    vi.advanceTimersByTime(3000);
    log.dispatch(tempo(130));

    expect(tempoEntries()).toHaveLength(2);
  });

  it("starts a fresh entry for the next drag, however fast it follows", () => {
    const { log, tempoEntries } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.endGesture();
    log.beginGesture();
    log.dispatch(tempo(130));
    log.endGesture();

    expect(tempoEntries()).toHaveLength(2);
  });

  it("does not merge two targets just because one drag touched both", () => {
    const { log } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.dispatch({ type: "setLength", lengthBeats: 64 });
    log.endGesture();

    expect(log.getEntries().map((entry) => entry.command.type)).toEqual(["setTempo", "setLength"]);
  });

  it("leaves one undo step for the drag", () => {
    const { project, log } = seeded();
    log.dispatch(tempo(90)); // something to land back on
    log.beginGesture();
    for (const bpm of [120, 130, 140]) {
      log.dispatch(tempo(bpm));
      vi.advanceTimersByTime(1000);
    }
    log.endGesture();
    expect(project.tempo).toBe(140);

    log.undo();
    expect(project.tempo).toBe(90);
  });

  it("survives an end with no begin, and a begin left open by the drag before it", () => {
    const { log, tempoEntries } = seeded();
    expect(() => log.endGesture()).not.toThrow();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.beginGesture(); // the previous drag never ended
    log.dispatch(tempo(130));
    log.endGesture();

    expect(tempoEntries()).toHaveLength(2);
  });
});

describe("one gesture, one forwarded edit", () => {
  it("sends nothing until the drag ends, then the value it settled on", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    for (const bpm of [120, 130, 140]) log.dispatch(tempo(bpm));
    expect(forwarded).toEqual([]);

    log.endGesture();
    expect(forwarded).toEqual([tempo(140)]);
  });

  it("sends a coalescable edit that no drag bounds once its window goes quiet", () => {
    const { log, forwarded } = seeded();
    log.dispatch(tempo(120));
    expect(forwarded).toEqual([]);

    vi.advanceTimersByTime(400);
    expect(forwarded).toEqual([tempo(120)]);
  });

  // The authority has to see edits in the order the log made them, so a held one goes first.
  it("sends the held edit before an edit that cannot coalesce", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.dispatch(track("t-1"));

    expect(forwarded.map((command) => command.type)).toEqual(["setTempo", "createTrack"]);
  });

  it("sends a drag whose end never arrives, rather than holding it forever", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    vi.advanceTimersByTime(5000);

    expect(forwarded).toEqual([tempo(120)]);
  });

  // What the shared session needs: its pending queue is what the live project is rebuilt from, so a
  // drag in progress has to be enqueued before any rebuild. The cost is two rows for that one drag.
  it("sends the drag so far on demand, and the rest when it ends", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.flushForward();
    expect(forwarded).toEqual([tempo(120)]);

    log.dispatch(tempo(130));
    log.endGesture();
    expect(forwarded).toEqual([tempo(120), tempo(130)]);
  });

  it("hands a held edit to the outgoing sink rather than dropping it", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.setRemote(null);

    expect(forwarded).toEqual([tempo(120)]);
  });

  it("sends the held edit at a commit boundary, so it lands on the near side of it", () => {
    const { log, forwarded } = seeded();
    log.beginGesture();
    log.dispatch(tempo(120));
    log.resetCoalescing();

    expect(forwarded).toEqual([tempo(120)]);
  });
});

describe("the drag gesture registry", () => {
  it("reports a drag to the registered log", () => {
    const { log, tempoEntries } = seeded();
    setDragGestureScope(log);

    beginDragGesture();
    log.dispatch(tempo(120));
    vi.advanceTimersByTime(3000);
    log.dispatch(tempo(130));
    endDragGesture();

    expect(tempoEntries()).toHaveLength(1);
  });

  it("is a no-op with nothing registered, so tests and stories need no wiring", () => {
    expect(() => {
      beginDragGesture();
      endDragGesture();
    }).not.toThrow();
  });
});
