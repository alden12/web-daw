/**
 * The piano roll: a pitch x time grid view of the clip. Click an empty cell to
 * add a note (snapped to the grid), click a note to delete it. A playhead line
 * tracks the scheduler during playback. All edits go through the clip store, so
 * the UI and MCP edit the same model.
 */
import { useEffect, useRef } from 'react';
import type { ClipStore } from '../audio/sequencer/clipStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import { GRID } from '../audio/sequencer/types';
import { useClip } from '../audio/sequencer/useClip';

const MIN_PITCH = 36; // C2
const MAX_PITCH = 83; // B5
const CELL_W = 16; // px per grid step (1/4 beat)
const ROW_H = 12; // px per semitone
const BEAT_W = CELL_W / GRID; // px per beat

const ROWS = MAX_PITCH - MIN_PITCH + 1;
const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
const pitchName = (pitch: number) => `C${Math.floor(pitch / 12) - 1}`;

export function PianoRoll({ clipStore, scheduler }: { clipStore: ClipStore; scheduler: Scheduler }) {
  const clip = useClip(clipStore);
  const playheadRef = useRef<HTMLDivElement>(null);

  const cols = Math.round(clip.lengthBeats / GRID);
  const width = cols * CELL_W;
  const height = ROWS * ROW_H;

  // Drive the playhead off the audio clock.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadRef.current;
      if (el) {
        el.style.transform = `translateX(${scheduler.getPositionBeats() * BEAT_W}px)`;
        el.style.opacity = scheduler.isPlaying ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scheduler]);

  const addAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const start = Math.floor(x / CELL_W) * GRID;
    const pitch = MAX_PITCH - Math.floor(y / ROW_H);
    if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
    clipStore.addNote({ pitch, start, length: 1, velocity: 0.8 });
  };

  // Background grid: beat lines, finer cell lines, semitone rows.
  const gridBg = [
    `repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px ${BEAT_W}px)`,
    `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${CELL_W}px)`,
    `repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px ${ROW_H}px)`,
  ].join(', ');

  return (
    <div className="max-w-full h-full overflow-auto border border-line rounded-lg bg-ground">
      <div className="relative cursor-copy" style={{ width, height, background: gridBg }} onClick={addAt}>
        {/* black-key row shading + octave labels */}
        {Array.from({ length: ROWS }, (_, row) => {
          const pitch = MAX_PITCH - row;
          return (
            <div
              key={pitch}
              className={`absolute left-0 right-0 pointer-events-none ${isBlackKey(pitch) ? 'bg-white/[0.035]' : ''}`}
              style={{ top: row * ROW_H, height: ROW_H }}
            >
              {pitch % 12 === 0 && (
                <span className="sticky left-0.5 font-mono text-[9px] text-muted pl-0.5">{pitchName(pitch)}</span>
              )}
            </div>
          );
        })}

        {clip.notes.map((note) => (
          <div
            key={note.id}
            className="absolute bg-you border border-you/40 rounded-sm cursor-pointer box-border hover:brightness-125"
            style={{
              left: note.start * BEAT_W,
              width: Math.max(2, note.length * BEAT_W - 1),
              top: (MAX_PITCH - note.pitch) * ROW_H,
              height: ROW_H - 1,
              opacity: 0.4 + 0.6 * note.velocity,
            }}
            title={`${pitchNote(note.pitch)} · ${note.start}+${note.length} beats`}
            onClick={(e) => {
              e.stopPropagation();
              clipStore.removeNote(note.id);
            }}
          />
        ))}

        <div ref={playheadRef} className="absolute top-0 left-0 w-0.5 bg-you pointer-events-none opacity-0" style={{ height }} />
      </div>
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function pitchNote(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}
