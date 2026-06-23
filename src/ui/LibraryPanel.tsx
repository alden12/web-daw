/**
 * The library (left): the instrument and effect catalogs as a collapsible tree.
 * Instrument leaves add a track; effect leaves attach to the selected track.
 * Both read from the same catalogs the engine and MCP use, so the tree never
 * drifts from what can actually be loaded.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import type { ProjectStore } from "../audio/project/projectStore";
import { INSTRUMENT_CATALOG } from "../audio/instruments/catalog";
import { EFFECT_CATALOG } from "../audio/effects/catalog";
import { audioStorageAvailable, putAudio } from "../audio/audioStore";
import type { Dispatch } from "../audio/commands/types";
import { newEffectId, newTrackId } from "../audio/commands/ids";

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
        <span className="w-2.5 text-[9px] text-muted">{open ? "▾" : "▸"}</span>
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
  dispatch,
}: {
  projectStore: ProjectStore;
  dispatch: Dispatch;
}) {
  const [importError, setImportError] = useState<string | null>(null);

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
      <div className="flex items-center gap-2 px-4 pb-4 font-semibold text-sm text-bright">
        <span
          className="w-4 h-4 rounded-full"
          style={{
            background:
              "conic-gradient(from 200deg, var(--color-you), var(--color-claude), var(--color-you))",
          }}
        />
        Web DAW
      </div>
      <div className="mx-3.5 mb-2 px-3 py-2 border border-line rounded-lg bg-ground text-faint text-xs">
        Search or ask…
      </div>

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">
        Instruments
      </div>
      <Category label="Synths">
        {Object.entries(INSTRUMENT_CATALOG).map(([type, def]) => (
          <Leaf
            key={type}
            label={def.label}
            onClick={() =>
              dispatch({
                type: "createTrack",
                instrumentType: type,
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
        {Object.entries(EFFECT_CATALOG).map(([type, def]) => (
          <Leaf
            key={type}
            label={def.label}
            fx
            onClick={() => {
              const hostId = projectStore.selectedId;
              if (hostId)
                dispatch({
                  type: "addEffect",
                  hostId,
                  effectType: type,
                  id: newEffectId(),
                });
            }}
          />
        ))}
      </Category>

      <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint px-4 pt-3 pb-1.5">
        Audio
      </div>
      <label className="flex items-center gap-2.5 w-full text-left pl-8 pr-4 py-1.5 text-[12.5px] text-ink cursor-pointer hover:bg-you/10">
        <span className="w-1.75 h-1.75 bg-line rounded-full" />
        Import audio…
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImport(file);
            e.target.value = "";
          }}
        />
      </label>
      {importError && (
        <p className="text-claude text-[11px] px-8 pt-1">{importError}</p>
      )}
    </div>
  );
}
