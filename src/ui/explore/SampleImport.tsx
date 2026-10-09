/**
 * The Samples page's two imports: a sample into the project's library (to play with the Sampler),
 * or an audio file straight onto a new audio track.
 */
import { useRef, useState, type RefObject } from "react";
import type { Dispatch } from "../../audio/commands/types";
import { newTrackId } from "../../audio/commands/ids";
import { importSampleFile } from "../../audio/samples/importSample";
import { audioStorageAvailable, putAudio } from "../../audio/audioStore";
import type { SampleAsset } from "../../audio/samples/catalog";

/** Read a clip's natural duration without needing the AudioContext to be started. */
function audioDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Audio();
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(element.duration) ? element.duration : 0);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read audio metadata"));
    };
    element.src = url;
  });
}

function ImportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 w-full text-left px-3.5 py-1.5 text-[12.5px] text-muted hover:text-ink cursor-pointer hover:bg-you/10"
    >
      <span aria-hidden="true" className="w-3.5 text-center leading-none">
        +
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function SampleImport({ samples, dispatch }: { samples: SampleAsset[]; dispatch: Dispatch }) {
  const [error, setError] = useState<string | null>(null);
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const importSample = async (file: File) => {
    setError(null);
    const ref = await importSampleFile(file, samples, dispatch);
    if (!ref) setError("Sample import failed (audio storage may be unavailable).");
  };

  const importAudio = async (file: File) => {
    setError(null);
    if (!audioStorageAvailable()) {
      setError("Audio storage is unavailable in this browser.");
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
      setError("Import failed.");
    }
  };

  const fileInput = (
    ref: RefObject<HTMLInputElement | null>,
    testId: string,
    onFile: (file: File) => Promise<void>,
  ) => (
    <input
      ref={ref}
      data-testid={testId}
      type="file"
      accept="audio/*"
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void onFile(file);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className="py-1">
      <ImportButton label="Import sample…" onClick={() => sampleInputRef.current?.click()} />
      <ImportButton label="Import audio as a track…" onClick={() => audioInputRef.current?.click()} />
      {error && <p className="text-hot text-[11px] px-3.5 py-1">{error}</p>}
      {fileInput(sampleInputRef, "sample-import-input", importSample)}
      {fileInput(audioInputRef, "audio-import-input", importAudio)}
    </div>
  );
}
