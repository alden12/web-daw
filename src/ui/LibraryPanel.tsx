/**
 * The library panel (beside the activity rail): shows exactly one view at a time -
 * the view chosen on the rail. A search box sits above the view title; typing shows
 * a grouped results view across tracks + the catalogs. The title bar and its main
 * menu live in `LibraryHeader`. Instruments / Effects / Patches / Samples read from
 * the same catalogs the engine and MCP use; Project and Activity delegate to their
 * own components.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { EMPTY_INSTRUMENT, pickableInstrumentInfos } from "../audio/instruments/catalog";
import { effectInfos } from "../audio/effects/catalog";
import { assetRef } from "../audio/samples/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import { audioStorageAvailable, putAudio } from "../audio/audioStore";
import { useProject } from "../audio/project/useProject";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId, newTrackId } from "../audio/commands/ids";
import { type Patch, listPatches, removePatch, subscribePatches } from "../audio/patches/library";
import { FACTORY_PATCHES } from "../audio/patches/factory";
import type { LibraryView } from "./ActivityRail";
import { ActivityView } from "./ActivityView";
import { ProjectView } from "./ProjectView";
import { LibraryHeader } from "./LibraryHeader";
import { Menu } from "./Menu";
import { voiceDot } from "./authorVoice";

/** Read a clip's natural duration without needing the AudioContext to be started. */
function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(el.duration) ? el.duration : 0);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read audio metadata"));
    };
    el.src = url;
  });
}

/** The "+" affordance on a library row: add the instrument/patch as a new track (as
 *  opposed to the row's primary click, which applies it to the current track). */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 w-6 text-center text-[16px] leading-none text-faint hover:text-bright cursor-pointer opacity-0 group-hover:opacity-100"
    >
      +
    </button>
  );
}

/** A catalog leaf: click to add an instrument track (or attach an effect to the selection). */
function Leaf({ label, fx, onClick }: { label: string; fx?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
    >
      <span className={`w-1.75 h-1.75 bg-line ${fx ? "rounded-full" : "rounded-sm"}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** A patch row: click the name to add a track, the kebab to delete it. Factory presets
 *  are read-only (no `onDelete`), marked with a neutral dot instead of an author color. */
function PatchLeaf({
  patch,
  onApply,
  onNew,
  onDelete,
  indent = false,
}: {
  patch: Patch;
  /** Primary click: apply to the current track (audition). */
  onApply: () => void;
  /** The "+" button: add as a new track. */
  onNew?: () => void;
  onDelete?: () => void;
  /** Extra left padding when nested under an instrument in the tree. */
  indent?: boolean;
}) {
  const dot = patch.builtin ? "bg-line" : voiceDot(patch.author);
  return (
    <div className={`group flex items-center w-full ${indent ? "pl-9" : "pl-3.5"} pr-2 hover:bg-you/10`}>
      <button
        type="button"
        onClick={onApply}
        title={`Apply "${patch.name}" to the selected track`}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left py-1.5 text-[12.5px] text-ink cursor-pointer"
      >
        <span aria-hidden="true" className={`w-1.75 h-1.75 rounded-sm shrink-0 ${dot}`} />
        <span className="truncate">{patch.name}</span>
      </button>
      {onNew && <AddButton label={`Add "${patch.name}" as a new track`} onClick={onNew} />}
      {onDelete && (
        <Menu
          label={`Patch actions: ${patch.name}`}
          triggerClassName="shrink-0 px-1 text-[13px] leading-none text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
          items={[{ label: "Delete patch", danger: true, onClick: onDelete }]}
        />
      )}
    </div>
  );
}

/** A project-library sample row: click the name to add a Sampler track on it, kebab to remove. */
function SampleLeaf({ name, onAdd, onRemove }: { name: string; onAdd: () => void; onRemove: () => void }) {
  return (
    <div className="group flex items-center w-full pl-3.5 pr-2 hover:bg-you/10">
      <button
        type="button"
        onClick={onAdd}
        title={`Add a Sampler track playing "${name}"`}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left py-1.5 text-[12.5px] text-ink cursor-pointer"
      >
        <span aria-hidden="true" className="w-1.75 h-1.75 rounded-sm shrink-0 bg-line" />
        <span className="truncate">{name}</span>
      </button>
      <Menu
        label={`Sample actions: ${name}`}
        triggerClassName="shrink-0 px-1 text-[13px] leading-none text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
        items={[{ label: "Remove from library", danger: true, onClick: onRemove }]}
      />
    </div>
  );
}

/** A results section header (grouped search results). */
function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-3.5 pt-2.5 pb-1 text-[10.5px] uppercase tracking-wide text-faint">{children}</div>;
}

/** An empty-view hint (no matches, or nothing saved yet). */
function Hint({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-2 text-[11.5px] text-faint">{children}</p>;
}

export function LibraryPanel({
  projectStore,
  editLog,
  versionStore,
  dispatch,
  activeView,
  search,
  onSearch,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
  activeView: LibraryView;
  search: string;
  onSearch: (query: string) => void;
}) {
  const project = useProject(projectStore);
  const [patches, setPatches] = useState<Patch[]>(() => listPatches());
  const [expandedInstruments, setExpandedInstruments] = useState<Set<string>>(() => new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // The patch library is global (cross-project); mirror it into React state.
  useEffect(() => {
    const sync = () => setPatches(listPatches());
    sync();
    return subscribePatches(sync);
  }, []);

  // Apply a saved patch as one authored edit. Effect ids are minted here and carried
  // in the command, so undo/redo and history replay reproduce the same track exactly.
  const addFromPatch = (patch: Patch) =>
    dispatch({
      type: "createTrackFromPatch",
      id: newTrackId(),
      name: patch.name,
      instrumentType: patch.instrumentType,
      params: patch.params,
      effects: patch.effects.map((fx) => ({
        id: newEffectId(),
        type: fx.type,
        bypassed: fx.bypassed,
        params: fx.params,
      })),
    });

  // Acting on a search result clears the query, which returns to the view that was
  // open before searching (or stays on Search if it was opened directly - see AppShell).
  const pickResult = (act: () => void) => {
    act();
    onSearch("");
  };

  const addInstrument = (type: string) => dispatch({ type: "createTrack", instrumentType: type, id: newTrackId() });

  // Auditioning: clicking an instrument/patch applies it to the selected instrument
  // track (so you can play it on your part); the "+" on each row adds it as a new track
  // instead. With no instrument track selected (none yet, or an audio track is), both
  // fall back to adding a new track.
  const selectedInstrumentTrack = project.tracks.find(
    (track) => track.id === project.selectedTrackId && track.kind === "instrument",
  );
  const applyInstrument = (type: string) => {
    if (selectedInstrumentTrack)
      dispatch({ type: "setInstrument", trackId: selectedInstrumentTrack.id, instrumentType: type });
    else addInstrument(type);
  };
  const applyPatchHere = (patch: Patch) => {
    if (!selectedInstrumentTrack) return addFromPatch(patch);
    dispatch({
      type: "applyPatch",
      trackId: selectedInstrumentTrack.id,
      name: patch.name,
      instrumentType: patch.instrumentType,
      params: patch.params,
      effects: patch.effects.map((fx) => ({
        id: newEffectId(),
        type: fx.type,
        bypassed: fx.bypassed,
        params: fx.params,
      })),
    });
  };

  const addEffect = (type: string) => {
    const hostId = projectStore.selectedId;
    if (hostId) dispatch({ type: "addEffect", hostId, effectType: type, id: newEffectId() });
  };
  // Add a Sampler track preloaded with a library sample (mirrors clicking an instrument).
  const addSamplerTrack = (assetId: string) => {
    const id = newTrackId();
    dispatch({ type: "createTrack", instrumentType: "sampler", id });
    dispatch({ type: "setParam", trackId: id, id: "sampler.sample", value: assetRef(assetId) });
  };

  const onImportSample = async (file: File) => {
    setImportError(null);
    const ref = await importSampleFile(file, project.samples, dispatch);
    if (!ref) setImportError("Sample import failed (audio storage may be unavailable).");
  };

  const onImportAudio = async (file: File) => {
    setImportError(null);
    if (!audioStorageAvailable()) {
      setImportError("Audio storage is unavailable in this browser.");
      return;
    }
    try {
      const [fileId, durationSec] = await Promise.all([putAudio(file), audioDuration(file).catch(() => 0)]);
      dispatch({
        type: "addAudioTrack",
        id: newTrackId(),
        fileId,
        name: file.name.replace(/\.[^.]+$/, ""),
        durationSec,
      });
    } catch {
      setImportError("Import failed.");
    }
  };

  // Factory presets (shipped, read-only) sit alongside the user's saved patches
  // everywhere patches appear: the flat Patches view, search, and nested under their
  // instrument in the Instruments view.
  const allPatches = [...FACTORY_PATCHES, ...patches];
  const patchesFor = (instrumentType: string) => allPatches.filter((patch) => patch.instrumentType === instrumentType);

  const query = search.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(query);
  const instruments = pickableInstrumentInfos().filter((def) => matches(def.label));
  const effects = effectInfos().filter((def) => matches(def.label));
  const matchedPatches = allPatches.filter((patch) => matches(patch.name));
  const matchedSamples = project.samples.filter((sample) => matches(sample.name));
  const matchedTracks = project.tracks.filter((track) => matches(track.name));

  // One renderer per view (data-driven, so adding a view is a single entry).
  const views: Record<LibraryView, () => ReactNode> = {
    search: () =>
      query === "" ? (
        <Hint>Type above to search tracks, instruments, effects, patches, and samples.</Hint>
      ) : instruments.length + effects.length + matchedPatches.length + matchedSamples.length + matchedTracks.length ===
        0 ? (
        <Hint>No matches for “{search.trim()}”.</Hint>
      ) : (
        <div className="pb-2">
          {matchedTracks.length > 0 && (
            <>
              <SectionLabel>Tracks</SectionLabel>
              {matchedTracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => pickResult(() => projectStore.selectTrack(track.id))}
                  title={`Select "${track.name}"`}
                  className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
                >
                  <span
                    aria-hidden="true"
                    className={`w-1.75 h-1.75 shrink-0 ${track.kind === "audio" ? "rounded-full" : "rounded-sm"} bg-line`}
                  />
                  <span className="truncate">{track.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wider text-faint">
                    {track.kind === "audio"
                      ? "audio"
                      : track.instrumentType === EMPTY_INSTRUMENT
                        ? "empty"
                        : track.instrumentType}
                  </span>
                </button>
              ))}
            </>
          )}
          {instruments.length > 0 && (
            <>
              <SectionLabel>Instruments</SectionLabel>
              {instruments.map((def) => (
                <Leaf key={def.type} label={def.label} onClick={() => pickResult(() => applyInstrument(def.type))} />
              ))}
            </>
          )}
          {effects.length > 0 && (
            <>
              <SectionLabel>Effects</SectionLabel>
              {effects.map((def) => (
                <Leaf key={def.type} label={def.label} fx onClick={() => pickResult(() => addEffect(def.type))} />
              ))}
            </>
          )}
          {matchedPatches.length > 0 && (
            <>
              <SectionLabel>Patches</SectionLabel>
              {matchedPatches.map((patch) => (
                <PatchLeaf
                  key={patch.id}
                  patch={patch}
                  onApply={() => pickResult(() => applyPatchHere(patch))}
                  onNew={() => pickResult(() => addFromPatch(patch))}
                  onDelete={patch.builtin ? undefined : () => removePatch(patch.id)}
                />
              ))}
            </>
          )}
          {matchedSamples.length > 0 && (
            <>
              <SectionLabel>Samples</SectionLabel>
              {matchedSamples.map((sample) => (
                <SampleLeaf
                  key={sample.id}
                  name={sample.name}
                  onAdd={() => pickResult(() => addSamplerTrack(sample.id))}
                  onRemove={() => dispatch({ type: "removeSample", id: sample.id })}
                />
              ))}
            </>
          )}
        </div>
      ),
    project: () => <ProjectView projectStore={projectStore} dispatch={dispatch} />,
    activity: () => <ActivityView editLog={editLog} versionStore={versionStore} />,
    instruments: () => (
      <div className="py-1">
        {pickableInstrumentInfos().map((def) => {
          const defPatches = patchesFor(def.type);
          const expanded = expandedInstruments.has(def.type);
          return (
            <div key={def.type}>
              <div className="group flex items-center w-full hover:bg-you/10">
                {/* Disclosure appears only for instruments that actually have patches,
                    so the list stays flat until there's something to expand. */}
                {defPatches.length > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedInstruments((set) => {
                        const next = new Set(set);
                        if (next.has(def.type)) next.delete(def.type);
                        else next.add(def.type);
                        return next;
                      })
                    }
                    aria-label={expanded ? `Collapse ${def.label} presets` : `Expand ${def.label} presets`}
                    className="shrink-0 w-7 pl-2 text-left text-[18px] leading-none text-faint hover:text-ink py-1 cursor-pointer"
                  >
                    {expanded ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="shrink-0 w-7 pl-2" />
                )}
                <button
                  type="button"
                  onClick={() => applyInstrument(def.type)}
                  title={`Set the selected track to ${def.label}`}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left pr-2 py-1.5 text-[12.5px] text-ink cursor-pointer"
                >
                  <span aria-hidden="true" className="w-1.75 h-1.75 rounded-sm shrink-0 bg-line" />
                  <span className="truncate">{def.label}</span>
                  {defPatches.length > 0 && (
                    <span className="ml-auto shrink-0 font-mono text-[9px] text-faint">{defPatches.length}</span>
                  )}
                </button>
                <AddButton label={`Add a ${def.label} track`} onClick={() => addInstrument(def.type)} />
              </div>
              {expanded &&
                defPatches.map((patch) => (
                  <PatchLeaf
                    key={patch.id}
                    patch={patch}
                    indent
                    onApply={() => applyPatchHere(patch)}
                    onNew={() => addFromPatch(patch)}
                    onDelete={patch.builtin ? undefined : () => removePatch(patch.id)}
                  />
                ))}
            </div>
          );
        })}
      </div>
    ),
    effects: () => (
      <div className="py-1">
        {effectInfos().map((def) => (
          <Leaf key={def.type} label={def.label} fx onClick={() => addEffect(def.type)} />
        ))}
      </div>
    ),
    patches: () => (
      <div className="py-1">
        {/* Factory presets first, grouped by category; then the user's saved patches. */}
        {[...new Set(FACTORY_PATCHES.map((patch) => patch.category))].map((category) => (
          <div key={category}>
            <SectionLabel>{category}</SectionLabel>
            {FACTORY_PATCHES.filter((patch) => patch.category === category).map((patch) => (
              <PatchLeaf
                key={patch.id}
                patch={patch}
                onApply={() => applyPatchHere(patch)}
                onNew={() => addFromPatch(patch)}
              />
            ))}
          </div>
        ))}
        <SectionLabel>Saved</SectionLabel>
        {patches.length === 0 ? (
          <Hint>Save an instrument as a patch (in the workbench) to reuse it here.</Hint>
        ) : (
          patches.map((patch) => (
            <PatchLeaf
              key={patch.id}
              patch={patch}
              onApply={() => applyPatchHere(patch)}
              onNew={() => addFromPatch(patch)}
              onDelete={() => removePatch(patch.id)}
            />
          ))
        )}
      </div>
    ),
    samples: () => (
      <div className="py-1">
        <button
          type="button"
          onClick={() => sampleInputRef.current?.click()}
          className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-muted hover:text-ink cursor-pointer hover:bg-you/10"
        >
          <span aria-hidden="true" className="w-3.5 text-center leading-none">
            +
          </span>
          <span className="truncate">Import sample…</span>
        </button>
        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-muted hover:text-ink cursor-pointer hover:bg-you/10"
        >
          <span aria-hidden="true" className="w-3.5 text-center leading-none">
            +
          </span>
          <span className="truncate">Import audio as a track…</span>
        </button>
        {importError && <p className="text-claude text-[11px] px-3.5 py-1">{importError}</p>}
        {project.samples.length === 0 ? (
          <Hint>Import a sample to play it with the Sampler.</Hint>
        ) : (
          project.samples.map((sample) => (
            <SampleLeaf
              key={sample.id}
              name={sample.name}
              onAdd={() => addSamplerTrack(sample.id)}
              onRemove={() => dispatch({ type: "removeSample", id: sample.id })}
            />
          ))
        )}
      </div>
    ),
  };

  return (
    <div className="[grid-area:library] min-w-0 bg-rail border-r border-line flex flex-col min-h-0">
      {/* Search sits above the view title; typing jumps to the Search results view. */}
      <div className="shrink-0 p-2 border-b border-line">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search library…"
          aria-label="Search the library"
          className="w-full px-2.5 py-1.5 border border-line rounded-md bg-ground text-ink placeholder:text-faint text-xs focus:outline-none focus:border-you"
        />
      </div>
      <LibraryHeader
        activeView={activeView}
        projectStore={projectStore}
        editLog={editLog}
        versionStore={versionStore}
      />
      <div className="flex-1 min-h-0 overflow-y-auto">{views[activeView]()}</div>

      {/* Hidden inputs for the Samples view's import actions. */}
      <input
        ref={sampleInputRef}
        data-testid="sample-import-input"
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportSample(file);
          e.target.value = "";
        }}
      />
      <input
        ref={audioInputRef}
        data-testid="audio-import-input"
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportAudio(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
