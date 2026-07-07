/**
 * The library (left): the instrument and effect catalogs as a collapsible tree.
 * Instrument leaves add a track; effect leaves attach to the selected track.
 * Both read from the same catalogs the engine and MCP use, so the tree never
 * drifts from what can actually be loaded.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import type { EditLog } from "../audio/commands/editLog";
import type { VersionStore } from "../audio/commands/history";
import { type ProjectMeta, listProjects, subscribeProjects } from "../audio/projects/library";
import { createProject, deleteProject, renameProject, switchProject } from "../audio/projects/operations";
import { currentProjectId } from "../audio/projectRepository";
import { instrumentInfos } from "../audio/instruments/catalog";
import { effectInfos } from "../audio/effects/catalog";
import { audioStorageAvailable, putAudio } from "../audio/audioStore";
import { assetRef } from "../audio/samples/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import { useProject } from "../audio/project/useProject";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId, newTrackId } from "../audio/commands/ids";
import { type Patch, listPatches, removePatch, subscribePatches } from "../audio/patches/library";
import { exportProjectFile, importProjectFile } from "./projectFile";
import { Menu } from "./Menu";

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

function Category({
  label,
  defaultOpen = true,
  nested = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  /** A sub-section inside another category: indented and lighter than a top-level title. */
  nested?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full text-left py-1.5 cursor-pointer ${
          nested ? "pl-8 pr-4 text-[12px] font-medium text-muted" : "px-4 text-xs font-semibold text-ink"
        }`}
      >
        <span className="w-2.5 text-2xl text-muted">{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open && children}
    </>
  );
}

function Leaf({
  label,
  fx,
  indent = "pl-8",
  onClick,
}: {
  label: string;
  fx?: boolean;
  indent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`flex items-center gap-2.5 w-full text-left ${indent} pr-4 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10`}
    >
      <span className={`w-1.75 h-1.75 bg-line ${fx ? "rounded-full" : "rounded-sm"}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** A saved-patch row: click the name to add a track, the × to delete the patch. */
function PatchLeaf({
  patch,
  indent = "pl-8",
  onAdd,
  onDelete,
}: {
  patch: Patch;
  indent?: string;
  onAdd: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`group flex items-center w-full ${indent} pr-2 hover:bg-you/10`}>
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

/** A project-library sample row: click the name to add a Sampler track on it, × to remove. */
function SampleLeaf({
  name,
  indent = "pl-8",
  onAdd,
  onRemove,
}: {
  name: string;
  indent?: string;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`group flex items-center w-full ${indent} pr-2 hover:bg-you/10`}>
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

export function LibraryPanel({
  projectStore,
  editLog,
  versionStore,
  dispatch,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  versionStore: VersionStore;
  dispatch: Dispatch;
}) {
  const project = useProject(projectStore);
  const [importError, setImportError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [patches, setPatches] = useState<Patch[]>(() => listPatches());
  const [projects, setProjects] = useState<ProjectMeta[]>(() => listProjects());
  const menuRef = useRef<HTMLDivElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const projectDeps = { projectStore, editLog, versionStore };

  // The patch library is global (cross-project); mirror it into React state.
  useEffect(() => {
    const sync = () => setPatches(listPatches());
    sync();
    return subscribePatches(sync);
  }, []);

  // Mirror the project library (populated at boot by initProjects).
  useEffect(() => {
    const sync = () => setProjects(listProjects());
    sync();
    return subscribeProjects(sync);
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

  // Close the project menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const onImportProject = async (file: File) => {
    setImportError(null);
    try {
      await importProjectFile(file, projectStore, editLog);
    } catch {
      setImportError("Could not open that .daw.zip file.");
    }
  };

  const onImport = async (file: File) => {
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

  // Import a file into the project sample library (for the Sampler), via the shared helper.
  const onImportSample = async (file: File) => {
    setImportError(null);
    const ref = await importSampleFile(file, project.samples, dispatch);
    if (!ref) setImportError("Sample import failed (audio storage may be unavailable).");
  };

  // Add a Sampler track preloaded with a library sample (mirrors clicking an instrument).
  const addSamplerTrack = (assetId: string) => {
    const id = newTrackId();
    dispatch({ type: "createTrack", instrumentType: "sampler", id });
    dispatch({ type: "setParam", trackId: id, id: "sampler.sample", value: assetRef(assetId) });
  };

  // Basic library search: filter each catalog by name (the box's "ask" use is future).
  const query = searchQuery.trim().toLowerCase();
  const matches = (label: string) => !query || label.toLowerCase().includes(query);
  const instruments = instrumentInfos().filter((def) => matches(def.label));
  const effects = effectInfos().filter((def) => matches(def.label));
  const matchedPatches = patches.filter((patch) => matches(patch.name));
  const matchedSamples = project.samples.filter((sample) => matches(sample.name));
  const noMatches =
    query !== "" && !instruments.length && !effects.length && !matchedPatches.length && !matchedSamples.length;

  return (
    <div className="[grid-area:library] bg-rail border-r border-line flex flex-col min-h-0">
      <div className="shrink-0 pt-3">
        <div className="flex items-center gap-1.5 px-3 pb-4 font-semibold text-sm text-bright">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              title="Project menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center justify-center w-6 h-6 rounded-md text-muted hover:text-bright hover:bg-ground cursor-pointer"
            >
              <span className="text-base leading-none">☰</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute z-30 left-0 mt-1 min-w-44 py-1 rounded-lg border border-line bg-card shadow-lg font-normal text-[12.5px] text-ink"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    audioInputRef.current?.click();
                  }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-you/10 cursor-pointer"
                >
                  Import audio…
                </button>
                <div className="my-1 border-t border-line" />
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void exportProjectFile(projectStore, editLog);
                  }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-you/10 cursor-pointer"
                >
                  Export project…
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    projectInputRef.current?.click();
                  }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-you/10 cursor-pointer"
                >
                  Import project…
                </button>
                <div className="my-1 border-t border-line" />
                <div className="px-3 py-1 text-[10.5px] uppercase tracking-wide text-faint">Projects</div>
                {projects.map((meta) => (
                  <div key={meta.id} className="group flex items-center pr-2 hover:bg-you/10">
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (meta.id !== currentProjectId()) void switchProject(projectDeps, meta.id);
                      }}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left px-3 py-1.5 cursor-pointer"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.id === currentProjectId() ? "bg-you" : "bg-transparent"}`}
                      />
                      <span className="truncate">{meta.name}</span>
                    </button>
                    <Menu
                      label={`Project actions: ${meta.name}`}
                      triggerClassName="shrink-0 px-1 text-[13px] leading-none text-faint hover:text-ink opacity-0 group-hover:opacity-100 cursor-pointer"
                      items={[
                        {
                          label: "Rename…",
                          onClick: () => {
                            const name = window.prompt("Rename project", meta.name)?.trim();
                            if (name) void renameProject(meta.id, name);
                          },
                        },
                        {
                          label: "Delete",
                          danger: true,
                          disabled: projects.length <= 1,
                          onClick: () => {
                            if (window.confirm(`Delete project "${meta.name}"? This cannot be undone.`)) {
                              setMenuOpen(false);
                              void deleteProject(projectDeps, meta.id);
                            }
                          },
                        },
                      ]}
                    />
                  </div>
                ))}
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void createProject(projectDeps);
                  }}
                  className="block w-full text-left px-3 py-1.5 hover:bg-you/10 cursor-pointer text-muted"
                >
                  + New project
                </button>
              </div>
            )}
          </div>
          <span
            className="w-4 h-4 rounded-full"
            style={{
              background: "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))",
            }}
          />
          Web DAW
        </div>

        {/* Hidden inputs driven by the menu items above. */}
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
            e.target.value = "";
          }}
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportProject(file);
            e.target.value = "";
          }}
        />
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
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search the library"
          className="block w-[calc(100%-1.75rem)] mx-3.5 mb-2 px-3 py-2 border border-line rounded-lg bg-ground text-ink placeholder:text-faint text-xs focus:outline-none focus:border-you"
        />
        {importError && <p className="text-claude text-[11px] px-4 pb-1">{importError}</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        {(instruments.length > 0 || matchedPatches.length > 0) && (
          <Category label="Instruments">
            {instruments.map((def) => (
              <Leaf
                key={def.type}
                label={def.label}
                onClick={() =>
                  dispatch({
                    type: "createTrack",
                    instrumentType: def.type,
                    id: newTrackId(),
                  })
                }
              />
            ))}
            {(query === "" || matchedPatches.length > 0) && (
              <Category label="Patches" nested>
                {matchedPatches.length === 0 ? (
                  <p className="pl-12 pr-4 py-1.5 text-[11.5px] text-faint">
                    Save an instrument as a patch to reuse it here.
                  </p>
                ) : (
                  matchedPatches.map((patch) => (
                    <PatchLeaf
                      key={patch.id}
                      patch={patch}
                      indent="pl-12"
                      onAdd={() => addFromPatch(patch)}
                      onDelete={() => removePatch(patch.id)}
                    />
                  ))
                )}
              </Category>
            )}
          </Category>
        )}

        {effects.length > 0 && (
          <Category label="Effects">
            {effects.map((def) => (
              <Leaf
                key={def.type}
                label={def.label}
                fx
                onClick={() => {
                  const hostId = projectStore.selectedId;
                  if (hostId)
                    dispatch({
                      type: "addEffect",
                      hostId,
                      effectType: def.type,
                      id: newEffectId(),
                    });
                }}
              />
            ))}
          </Category>
        )}

        {(query === "" || matchedSamples.length > 0) && (
          <Category label="Samples">
            <button
              type="button"
              onClick={() => sampleInputRef.current?.click()}
              className="flex items-center gap-2.5 w-full text-left pl-8 pr-4 py-1.5 text-[12.5px] text-muted hover:text-ink cursor-pointer hover:bg-you/10"
            >
              <span aria-hidden="true" className="w-3.5 text-center leading-none">
                +
              </span>
              <span className="truncate">Import sample…</span>
            </button>
            {matchedSamples.length === 0 && query === "" ? (
              <p className="pl-12 pr-4 py-1.5 text-[11.5px] text-faint">Import a sample to play it with the Sampler.</p>
            ) : (
              matchedSamples.map((sample) => (
                <SampleLeaf
                  key={sample.id}
                  name={sample.name}
                  onAdd={() => addSamplerTrack(sample.id)}
                  onRemove={() => dispatch({ type: "removeSample", id: sample.id })}
                />
              ))
            )}
          </Category>
        )}

        {noMatches && <p className="px-4 py-2 text-[11.5px] text-faint">No matches for “{searchQuery.trim()}”.</p>}
      </div>
    </div>
  );
}
