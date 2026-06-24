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
import { instrumentInfos } from "../audio/instruments/catalog";
import { effectInfos } from "../audio/effects/catalog";
import { audioStorageAvailable, putAudio } from "../audio/audioStore";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId, newTrackId } from "../audio/commands/ids";
import {
  type Patch,
  listPatches,
  removePatch,
  subscribePatches,
} from "../audio/patches/library";
import { exportProjectFile, importProjectFile } from "./projectFile";

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
  chip,
  indent = "pl-8",
  onClick,
}: {
  label: string;
  fx?: boolean;
  chip?: string;
  indent?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full text-left ${indent} pr-4 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10`}
    >
      <span
        className={`w-1.75 h-1.75 bg-line ${fx ? "rounded-full" : "rounded-sm"}`}
      />
      <span className="truncate">{label}</span>
      {chip && (
        <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wide text-faint bg-line/40 rounded px-1 py-0.5">
          {chip}
        </span>
      )}
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
      <button
        type="button"
        title="Delete patch"
        aria-label={`Delete patch ${patch.name}`}
        onClick={onDelete}
        className="shrink-0 px-1.5 text-faint opacity-0 group-hover:opacity-100 hover:text-claude cursor-pointer"
      >
        ×
      </button>
    </div>
  );
}

export function LibraryPanel({
  projectStore,
  editLog,
  dispatch,
}: {
  projectStore: ProjectStore;
  editLog: EditLog;
  dispatch: Dispatch;
}) {
  const [importError, setImportError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [patches, setPatches] = useState<Patch[]>(() => listPatches());
  const menuRef = useRef<HTMLDivElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

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

  // Close the project menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
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
      const [fileId, durationSec] = await Promise.all([
        putAudio(file),
        audioDuration(file).catch(() => 0),
      ]);
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

  return (
    <div className="[grid-area:library] bg-rail border-r border-line overflow-y-auto py-3">
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
            </div>
          )}
        </div>
        <span
          className="w-4 h-4 rounded-full"
          style={{
            background:
              "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))",
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

      <div className="mx-3.5 mb-2 px-3 py-2 border border-line rounded-lg bg-ground text-faint text-xs">
        Search or ask…
      </div>
      {importError && (
        <p className="text-claude text-[11px] px-4 pb-1">{importError}</p>
      )}

      <Category label="Instruments">
        {instrumentInfos().map((def) => (
          <Leaf
            key={def.type}
            label={def.label}
            chip={def.family}
            onClick={() =>
              dispatch({
                type: "createTrack",
                instrumentType: def.type,
                id: newTrackId(),
              })
            }
          />
        ))}
        <Category label="Patches" nested>
          {patches.length === 0 ? (
            <p className="pl-12 pr-4 py-1.5 text-[11.5px] text-faint">
              Save an instrument as a patch to reuse it here.
            </p>
          ) : (
            patches.map((patch) => (
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
      </Category>

      <Category label="Effects">
        {effectInfos().map((def) => (
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
    </div>
  );
}
