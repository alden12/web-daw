/**
 * The library panel (beside the activity rail): shows exactly one view at a time -
 * the view chosen on the rail. A search box sits above the view title; typing shows
 * a grouped results view across the catalogs. The header also carries the app chrome
 * that used to live in a top toolbar: an undo/redo menu (left of the title) and the
 * MCP connection dot (right). Instruments / Effects / Patches / Samples read from the
 * same catalogs the engine and MCP use; Project and Activity delegate to their own
 * components.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import type { McpStatus } from "../audio/mcp/bridge";
import { useEditLog } from "../audio/commands/useEditLog";
import { instrumentInfos } from "../audio/instruments/catalog";
import { effectInfos } from "../audio/effects/catalog";
import { assetRef } from "../audio/samples/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import { audioStorageAvailable, putAudio } from "../audio/audioStore";
import { useProject } from "../audio/project/useProject";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId, newTrackId } from "../audio/commands/ids";
import { type Patch, listPatches, removePatch, subscribePatches } from "../audio/patches/library";
import type { LibraryView } from "./ActivityRail";
import { ActivityView } from "./ActivityView";
import { ProjectView } from "./ProjectView";
import { Menu } from "./Menu";

const VIEW_TITLE: Record<LibraryView, string> = {
  search: "Search",
  project: "Projects",
  instruments: "Instruments",
  effects: "Effects",
  patches: "Patches",
  samples: "Samples",
  activity: "Activity",
};

const MCP_DOT: Record<McpStatus, string> = {
  connected: "bg-good",
  connecting: "bg-warn",
  disconnected: "bg-claude",
};

const MCP_TITLE: Record<McpStatus, string> = {
  connected: "MCP connected",
  connecting: "MCP connecting…",
  disconnected: "MCP disconnected",
};

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

/** A saved-patch row: click the name to add a track, the kebab to delete the patch. */
function PatchLeaf({ patch, onAdd, onDelete }: { patch: Patch; onAdd: () => void; onDelete: () => void }) {
  return (
    <div className="group flex items-center w-full pl-3.5 pr-2 hover:bg-you/10">
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-2.5 flex-1 min-w-0 text-left py-1.5 text-[12.5px] text-ink cursor-pointer"
      >
        <span
          aria-hidden="true"
          title={`Saved by ${patch.author === "claude" ? "Claude" : "you"}`}
          className={`w-1.75 h-1.75 rounded-sm shrink-0 ${patch.author === "claude" ? "bg-claude" : "bg-you"}`}
        />
        <span className="truncate">{patch.name}</span>
      </button>
      <Menu
        label={`Patch actions: ${patch.name}`}
        triggerClassName="shrink-0 px-1 text-[13px] leading-none text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
        items={[{ label: "Delete patch", danger: true, onClick: onDelete }]}
      />
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
  mcpStatus,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
  activeView: LibraryView;
  search: string;
  onSearch: (query: string) => void;
  mcpStatus: McpStatus;
}) {
  const project = useProject(projectStore);
  const { canUndo, canRedo } = useEditLog(editLog);
  const [patches, setPatches] = useState<Patch[]>(() => listPatches());
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

  const addInstrument = (type: string) => dispatch({ type: "createTrack", instrumentType: type, id: newTrackId() });
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

  const query = search.trim().toLowerCase();
  const matches = (label: string) => label.toLowerCase().includes(query);
  const instruments = instrumentInfos().filter((def) => matches(def.label));
  const effects = effectInfos().filter((def) => matches(def.label));
  const matchedPatches = patches.filter((patch) => matches(patch.name));
  const matchedSamples = project.samples.filter((sample) => matches(sample.name));

  // One renderer per view (data-driven, so adding a view is a single entry).
  const views: Record<LibraryView, () => ReactNode> = {
    search: () =>
      query === "" ? (
        <Hint>Type above to search instruments, effects, patches, and samples.</Hint>
      ) : instruments.length + effects.length + matchedPatches.length + matchedSamples.length === 0 ? (
        <Hint>No matches for “{search.trim()}”.</Hint>
      ) : (
        <div className="pb-2">
          {instruments.length > 0 && (
            <>
              <SectionLabel>Instruments</SectionLabel>
              {instruments.map((def) => (
                <Leaf key={def.type} label={def.label} onClick={() => addInstrument(def.type)} />
              ))}
            </>
          )}
          {effects.length > 0 && (
            <>
              <SectionLabel>Effects</SectionLabel>
              {effects.map((def) => (
                <Leaf key={def.type} label={def.label} fx onClick={() => addEffect(def.type)} />
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
                  onAdd={() => addFromPatch(patch)}
                  onDelete={() => removePatch(patch.id)}
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
                  onAdd={() => addSamplerTrack(sample.id)}
                  onRemove={() => dispatch({ type: "removeSample", id: sample.id })}
                />
              ))}
            </>
          )}
        </div>
      ),
    project: () => <ProjectView projectStore={projectStore} editLog={editLog} versionStore={versionStore} />,
    activity: () => <ActivityView editLog={editLog} versionStore={versionStore} />,
    instruments: () => (
      <div className="py-1">
        {instrumentInfos().map((def) => (
          <Leaf key={def.type} label={def.label} onClick={() => addInstrument(def.type)} />
        ))}
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
        {patches.length === 0 ? (
          <Hint>Save an instrument as a patch (in the workbench) to reuse it here.</Hint>
        ) : (
          patches.map((patch) => (
            <PatchLeaf
              key={patch.id}
              patch={patch}
              onAdd={() => addFromPatch(patch)}
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
    <div className="flex-1 min-w-0 bg-rail border-r border-line flex flex-col min-h-0">
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
      {/* View header: undo/redo menu (left), title, MCP dot (right). */}
      <div className="shrink-0 flex items-center gap-2 h-9 px-2.5 border-b border-line">
        <Menu
          label="History"
          align="left"
          triggerClassName="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-muted hover:text-bright hover:bg-ground cursor-pointer text-base leading-none"
          items={[
            { label: "Undo", disabled: !canUndo, onClick: () => editLog.undo() },
            { label: "Redo", disabled: !canRedo, onClick: () => editLog.redo() },
          ]}
        />
        <span className="font-semibold text-[13px] text-bright">{VIEW_TITLE[activeView]}</span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-muted"
          title={MCP_TITLE[mcpStatus]}
        >
          <span className={`w-2 h-2 rounded-full ${MCP_DOT[mcpStatus]}`} /> MCP
        </span>
      </div>
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
