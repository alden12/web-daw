/**
 * The control for a `sample` param: choose a built-in or a project-library sample,
 * or import a file. Used by the generic Knob for `kind: "sample"` specs. Kept as
 * its own component because, unlike the other param controls, it needs the
 * project's sample library and an import action threaded in from the panel.
 */
import { useRef } from "react";
import type { ParamSpec } from "../audio/params/types";
import { BUILTIN_SAMPLES, builtinRef, type SampleAsset } from "../audio/samples/catalog";

export function SamplePicker({
  spec,
  value,
  onChange,
  assets,
  onImportFile,
}: {
  spec: ParamSpec;
  value: string;
  onChange: (id: string, value: string) => void;
  assets: SampleAsset[];
  /** Import a local file into the library; resolves to its ref (or null on failure). */
  onImportFile?: (file: File) => Promise<string | null>;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);

  const onPick = async (file: File) => {
    const ref = await onImportFile?.(file);
    if (ref) onChange(spec.id, ref);
  };

  return (
    <label className="flex flex-col items-center gap-1.5 w-24">
      <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
      <div className="flex items-center gap-1 w-full">
        <select
          value={value}
          onChange={(e) => onChange(spec.id, e.target.value)}
          className="flex-1 min-w-0 font-mono text-[11px] bg-ground text-ink border border-line rounded-md px-1.5 py-1"
        >
          <option value="">None</option>
          <optgroup label="Built-in">
            {BUILTIN_SAMPLES.map((sample) => (
              <option key={sample.id} value={builtinRef(sample.id)}>
                {sample.name}
              </option>
            ))}
          </optgroup>
          {assets.length > 0 && (
            <optgroup label="Imported">
              {assets.map((asset) => (
                <option key={asset.id} value={`asset:${asset.id}`}>
                  {asset.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {onImportFile && (
          <>
            <button
              type="button"
              title="Import a sample file"
              aria-label="Import a sample file"
              onClick={() => fileInput.current?.click()}
              className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md border border-line text-muted hover:text-ink hover:border-claude/55 cursor-pointer"
            >
              +
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPick(file);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
    </label>
  );
}
