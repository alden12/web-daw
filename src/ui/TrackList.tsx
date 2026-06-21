/**
 * The track list: add/select/mute/volume/remove tracks. Add buttons come from
 * the instrument catalog (one entry per engine). All edits go through the
 * project store, the same model MCP drives.
 */
import type { ProjectStore } from '../audio/project/projectStore';
import { useProject } from '../audio/project/useProject';
import { INSTRUMENT_CATALOG } from '../audio/instruments/catalog';

export function TrackList({ projectStore }: { projectStore: ProjectStore }) {
  const project = useProject(projectStore);

  return (
    <div className="tracks">
      <div className="tracks-list">
        {project.tracks.map((t) => (
          <div
            key={t.id}
            className={`track-row${t.id === project.selectedTrackId ? ' selected' : ''}`}
            onClick={() => projectStore.selectTrack(t.id)}
          >
            <button
              type="button"
              className={`track-mute${t.muted ? ' on' : ''}`}
              title={t.muted ? 'Unmute' : 'Mute'}
              onClick={(e) => {
                e.stopPropagation();
                projectStore.setMuted(t.id, !t.muted);
              }}
            >
              M
            </button>
            <span className="track-name">{t.name}</span>
            <span className="track-instrument">{INSTRUMENT_CATALOG[t.instrumentType]?.label ?? t.instrumentType}</span>
            <input
              type="range"
              className="track-volume"
              min={0}
              max={1}
              step={0.01}
              value={t.volume}
              title="Volume"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => projectStore.setVolume(t.id, Number(e.target.value))}
            />
            <button
              type="button"
              className="track-remove"
              title="Remove track"
              onClick={(e) => {
                e.stopPropagation();
                projectStore.removeTrack(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tracks-add">
        {Object.entries(INSTRUMENT_CATALOG).map(([type, def]) => (
          <button key={type} type="button" className="track-add" onClick={() => projectStore.addTrack(type)}>
            + {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}
