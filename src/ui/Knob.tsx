/**
 * A generic, schema-driven control. Given a ParamSpec it renders the right
 * control for the param's kind and reads/writes through the store. There is no
 * per-parameter UI code anywhere - panels are just this mapped over a schema.
 */
import { useRef } from "react";
import type { ReactElement } from "react";
import type { EnumSpec, NumberSpec, ParamSpec, ParamValue } from "../audio/params/types";
import type { ParamStore } from "../audio/params/store";
import { useParam } from "../audio/params/useParam";
import { fromNormalized, toNormalized } from "../audio/params/taper";
import type { SampleAsset } from "../audio/samples/catalog";
import { SamplePicker } from "./SamplePicker";
import { pitchName } from "./noteNames";
import { voiceFill, voiceIndicator } from "./authorVoice";

/** Extra context the `sample` control needs (the project library + import action);
 *  optional, since only instrument panels with a sample param supply it. */
export interface SampleContext {
  assets: SampleAsset[];
  onImportFile?: (file: File) => Promise<string | null>;
  /** Reveal the Samples library view (fired when an empty picker is clicked). */
  onReveal?: () => void;
}

const DRAG_SENSITIVITY = 1 / 200; // normalized units per pixel dragged

/** Writes go through an injected callback so every edit becomes a logged command;
 *  reads stay live via useParam (the value updates after the command applies). */
type OnChange = (id: string, value: ParamValue) => void;

function formatValue(spec: NumberSpec, value: number): string {
  if (spec.format === "note") return pitchName(value);
  const decimals = Math.abs(value) < 10 && !Number.isInteger(value) ? 2 : 0;
  const text = value.toFixed(decimals);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

/** A note-name dropdown for a `format: "note"` number param - the value stays a MIDI
 *  note number, but it reads as C2/C#2/... to match the piano roll. */
function NoteSelect({
  spec,
  store,
  onChange,
  hideLabel,
}: {
  spec: NumberSpec;
  store: ParamStore;
  onChange: OnChange;
  hideLabel?: boolean;
}) {
  const [value] = useParam(store, spec.id);
  const notes = Array.from({ length: spec.max - spec.min + 1 }, (_unused, index) => spec.min + index);
  return (
    <label className={hideLabel ? "flex items-center" : "flex flex-col items-center gap-1.5"}>
      {!hideLabel && <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>}
      <select
        value={String(value)}
        aria-label={spec.label}
        onChange={(e) => onChange(spec.id, Number(e.target.value))}
        className="font-mono text-[11px] bg-ground text-ink border border-line rounded-md px-1.5 py-1"
      >
        {notes.map((note) => (
          <option key={note} value={note}>
            {pitchName(note)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A horizontal fader for a number param - label on the left, value on the right, track
 *  stretching between. Used in the compact drum-pad layout. Snaps to `spec.step` via the
 *  store's coercion. */
function NumberHSlider({
  spec,
  store,
  onChange,
  author,
}: {
  spec: NumberSpec;
  store: ParamStore;
  onChange: OnChange;
  author?: string;
}) {
  const [value] = useParam(store, spec.id);
  const drag = useRef<{ startX: number; width: number; startNorm: number } | null>(null);
  const norm = toNormalized(spec, value as number);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, width: e.currentTarget.getBoundingClientRect().width, startNorm: norm };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nextNorm = Math.min(
      1,
      Math.max(0, drag.current.startNorm + (e.clientX - drag.current.startX) / drag.current.width),
    );
    onChange(spec.id, fromNormalized(spec, nextNorm));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <label className="flex items-center gap-2 w-full">
      <span className="w-10 shrink-0 text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
      <div
        className="relative flex-1 h-2 rounded-full bg-ground border border-line cursor-ew-resize touch-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value as number}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span
          className={`absolute left-0 top-0 bottom-0 rounded-full ${voiceFill(author ?? "you")}`}
          style={{ width: `${norm * 100}%` }}
        />
        <span
          className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-card shadow"
          style={{ left: `${norm * 100}%` }}
        />
      </div>
      <span className="w-11 shrink-0 text-right font-mono text-[10px] text-ink">
        {formatValue(spec, value as number)}
      </span>
    </label>
  );
}

function NumberKnob({
  spec,
  store,
  onChange,
  author,
}: {
  spec: NumberSpec;
  store: ParamStore;
  onChange: OnChange;
  author?: string;
}) {
  const [value] = useParam(store, spec.id);
  const drag = useRef<{ startY: number; startNorm: number } | null>(null);
  const norm = toNormalized(spec, value as number);
  const angle = -135 + norm * 270;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startNorm: norm };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const nextNorm = Math.min(1, Math.max(0, drag.current.startNorm - dy * DRAG_SENSITIVITY));
    onChange(spec.id, fromNormalized(spec, nextNorm));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-1.5 w-14">
      <div
        className="relative w-10 h-10 rounded-full bg-ground border border-line cursor-ns-resize touch-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value as number}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span
          className={`absolute left-1/2 bottom-1/2 w-0.5 h-4 rounded-full origin-bottom ${voiceIndicator(author ?? "you")}`}
          style={{ transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-muted text-center leading-tight">{spec.label}</span>
      <span className="font-mono text-[10px] text-ink">{formatValue(spec, value as number)}</span>
    </div>
  );
}

/** A vertical fader for a number param - the same drag logic as the knob, drawn as a
 *  slider so sectioned instrument panels read like a hardware synth. */
function NumberSlider({
  spec,
  store,
  onChange,
  author,
}: {
  spec: NumberSpec;
  store: ParamStore;
  onChange: OnChange;
  author?: string;
}) {
  const [value] = useParam(store, spec.id);
  const drag = useRef<{ startY: number; startNorm: number } | null>(null);
  const norm = toNormalized(spec, value as number);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startNorm: norm };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    const nextNorm = Math.min(1, Math.max(0, drag.current.startNorm - dy * DRAG_SENSITIVITY));
    onChange(spec.id, fromNormalized(spec, nextNorm));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };

  return (
    <div className="flex flex-col items-center gap-1.5 w-12">
      <div
        className="relative w-2 h-16 rounded-full bg-ground border border-line cursor-ns-resize touch-none focus-visible:[outline:2px_solid_var(--color-you)] focus-visible:outline-offset-2"
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value as number}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span
          className={`absolute left-0 right-0 bottom-0 rounded-full ${voiceFill(author ?? "you")}`}
          style={{ height: `${norm * 100}%` }}
        />
        <span
          className="absolute left-1/2 h-1.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-line bg-card shadow"
          style={{ bottom: `${norm * 100}%` }}
        />
      </div>
      <span className="text-[9px] uppercase tracking-wide text-muted text-center leading-tight">{spec.label}</span>
      <span className="font-mono text-[10px] text-ink">{formatValue(spec, value as number)}</span>
    </div>
  );
}

export function Knob({
  spec,
  store,
  onChange,
  sampleContext,
  variant = "knob",
  hideLabel,
  author,
}: {
  spec: ParamSpec;
  store: ParamStore;
  onChange: OnChange;
  /** Supplied by instrument panels so a `sample` param can browse/import; omitted elsewhere. */
  sampleContext?: SampleContext;
  /** How a number param is drawn: a rotary knob (default), a vertical fader, or a
   *  horizontal fader row (label left, value right). */
  variant?: "knob" | "slider" | "row";
  /** Drop the control's own label (the surrounding layout supplies it). */
  hideLabel?: boolean;
  /** Last editor of this param; tints the fill/pointer. Omit to leave it the default voice. */
  author?: string;
}) {
  const [value] = useParam(store, spec.id);

  // One renderer per kind (map dispatch). useParam runs above unconditionally, so
  // hook order is stable regardless of which renderer is picked.
  const renderers: Record<ParamSpec["kind"], () => ReactElement> = {
    number: () =>
      (spec as NumberSpec).format === "note" ? (
        <NoteSelect spec={spec as NumberSpec} store={store} onChange={onChange} hideLabel={hideLabel} />
      ) : variant === "row" ? (
        <NumberHSlider spec={spec as NumberSpec} store={store} onChange={onChange} author={author} />
      ) : variant === "slider" ? (
        <NumberSlider spec={spec as NumberSpec} store={store} onChange={onChange} author={author} />
      ) : (
        <NumberKnob spec={spec as NumberSpec} store={store} onChange={onChange} author={author} />
      ),
    enum: () => (
      <label className="flex flex-col items-center gap-1.5 w-14">
        <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
        <select
          value={value as string}
          onChange={(e) => onChange(spec.id, e.target.value)}
          className="font-mono text-[11px] bg-ground text-ink border border-line rounded-md px-1.5 py-1"
        >
          {(spec as EnumSpec).options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    ),
    boolean: () => (
      <label className="flex flex-col items-center gap-1.5 w-14">
        <span className="text-[9px] uppercase tracking-wide text-muted">{spec.label}</span>
        <input type="checkbox" checked={value as boolean} onChange={(e) => onChange(spec.id, e.target.checked)} />
      </label>
    ),
    // The sample picker lists built-ins + the project library, and can import a
    // file. It needs project context, so the panel threads it via sampleContext.
    sample: () => (
      <SamplePicker
        spec={spec}
        value={value as string}
        onChange={onChange}
        assets={sampleContext?.assets ?? []}
        onImportFile={sampleContext?.onImportFile}
        onReveal={sampleContext?.onReveal}
      />
    ),
  };

  return renderers[spec.kind]();
}
