/**
 * The arrangement timeline (bottom): one lane per track, on a shared bar grid,
 * with a playhead that tracks the scheduler. Lane headers carry the track
 * controls (select, mute, volume, remove) that used to live in TrackList.
 *
 * Current model is one loop per track, so each lane shows a single clip region
 * with a mini preview of its notes. Multiple clips / arrangement come with the
 * data-model slice.
 */
import { useEffect, useRef } from 'react';
import type { ProjectStore } from '../audio/project/projectStore';
import type { ClipStore } from '../audio/sequencer/clipStore';
import type { Scheduler } from '../audio/sequencer/scheduler';
import { useProject } from '../audio/project/useProject';
import { useClip } from '../audio/sequencer/useClip';

function Lane({ clipStore }: { clipStore: ClipStore }) {
  const clip = useClip(clipStore);
  const pitches = clip.notes.map((n) => n.pitch);
  const lo = pitches.length ? Math.min(...pitches) : 48;
  const hi = pitches.length ? Math.max(...pitches) : 72;
  const span = Math.max(1, hi - lo);
  return (
    <div className="h-11.5 shrink-0 relative border-b border-line-soft lane-grid">
      <div className="absolute top-2 bottom-2 left-[0.4%] right-[0.4%] rounded bg-card border border-line border-t-2 border-t-you overflow-hidden">
        {clip.notes.map((n) => (
          <div
            key={n.id}
            className="absolute h-0.5 rounded-[1px] bg-you/85"
            style={{
              left: `${(n.start / clip.lengthBeats) * 100}%`,
              width: `${Math.max(1.5, (n.length / clip.lengthBeats) * 100)}%`,
              bottom: `${((n.pitch - lo) / span) * 70 + 14}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function ArrangementTimeline({ projectStore, scheduler }: { projectStore: ProjectStore; scheduler: Scheduler }) {
  const project = useProject(projectStore);
  const playheadRef = useRef<HTMLDivElement>(null);
  const lengthBeats = project.lengthBeats;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = playheadRef.current;
      if (el) {
        el.style.left = `${((scheduler.getPositionBeats() % lengthBeats) / lengthBeats) * 100}%`;
        el.style.opacity = scheduler.isPlaying ? '1' : '0';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scheduler, lengthBeats]);

  return (
    <div className="[grid-area:timeline] bg-ground border-t border-line flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-3.5 py-1.5 border-b border-line bg-rail">
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">Arrangement</span>
        <span className="ml-auto font-mono text-[10px] text-faint tracking-[0.4em]">1&nbsp;&nbsp;2&nbsp;&nbsp;3&nbsp;&nbsp;4</span>
      </div>

      {project.tracks.length === 0 ? (
        <div className="flex-1 grid place-items-center text-muted text-sm p-5">
          No tracks yet. Add an instrument from the library.
        </div>
      ) : (
        <div className="grid grid-cols-[200px_1fr] flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col border-r border-line">
            {project.tracks.map((t) => (
              <div
                key={t.id}
                onClick={() => projectStore.selectTrack(t.id)}
                className={`h-11.5 shrink-0 flex items-center gap-2 px-2.5 border-b border-line-soft cursor-pointer ${
                  t.id === project.selectedTrackId ? 'bg-you/10 shadow-[inset_3px_0_0_var(--color-you)]' : 'bg-panel'
                }`}
              >
                <button
                  type="button"
                  title={t.muted ? 'Unmute' : 'Mute'}
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.setMuted(t.id, !t.muted);
                  }}
                  className={`font-mono w-6 h-6 rounded-md border text-xs cursor-pointer shrink-0 ${
                    t.muted ? 'border-claude text-claude' : 'border-line bg-card text-ink'
                  }`}
                >
                  M
                </button>
                <span className="font-mono text-[13px] text-bright flex-1 min-w-0 truncate">{t.name}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={t.volume}
                  title="Volume"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => projectStore.setVolume(t.id, Number(e.target.value))}
                  className="w-14 shrink-0"
                />
                <button
                  type="button"
                  title="Remove track"
                  onClick={(e) => {
                    e.stopPropagation();
                    projectStore.removeTrack(t.id);
                  }}
                  className="font-mono w-6 h-6 rounded-md border border-line bg-card text-ink cursor-pointer shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="relative flex flex-col">
            {project.tracks.map((t) => {
              const track = projectStore.getTrack(t.id);
              return track ? <Lane key={t.id} clipStore={track.clip} /> : <div key={t.id} className="h-11.5 shrink-0" />;
            })}
            <div ref={playheadRef} className="absolute top-0 bottom-0 w-px bg-you pointer-events-none opacity-0 z-5" />
          </div>
        </div>
      )}
    </div>
  );
}
