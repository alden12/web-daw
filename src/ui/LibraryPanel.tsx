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
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-4 py-1.5 text-xs font-semibold text-ink cursor-pointer"
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
  onClick,
}: {
  label: string;
  fx?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full text-left pl-8 pr-4 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10"
    >
      <span
        className={`w-1.75 h-1.75 bg-line ${fx ? "rounded-full" : "rounded-sm"}`}
      />
      {label}
    </button>
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
  const menuRef = useRef<HTMLDivElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

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

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">
        Instruments
      </div>
      <Category label="Synths">
        {instrumentInfos().map((def) => (
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
      </Category>

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">
        Effects
      </div>
      <Category label="All effects">
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
