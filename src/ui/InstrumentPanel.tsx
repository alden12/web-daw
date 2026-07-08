/**
 * The selected track's instrument as a device card in the signal-chain strip. Still
 * fully schema-driven (no per-instrument-type UI): the panel groups the params into
 * labeled sections by their id namespace (`osc.` / `filter.` / `env.` / `lfo.` / ...)
 * and lays those sections out left-to-right in signal-flow order, so an instrument
 * reads like a hardware synth panel (LFO -> oscillator -> filter -> envelope -> amp)
 * rather than an undifferentiated bank of knobs. A new engine with its own schema gets
 * the same treatment for free; unknown namespaces just get a title-cased section.
 */
import type { ParamStore } from "../audio/params/store";
import { instrumentSchema, catalogEntry } from "../audio/instruments/catalog";
import type { Dispatch } from "../audio/commands/types";
import type { SampleAsset } from "../audio/samples/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import { Knob, type SampleContext } from "./Knob";
import { toSections, sectionTitle } from "./paramSections";

export function InstrumentPanel({
  params,
  instrumentType,
  trackId,
  dispatch,
  samples,
  onRevealSamples,
}: {
  params: ParamStore;
  instrumentType: string;
  trackId: string;
  dispatch: Dispatch;
  /** The project sample library, threaded down so a `sample` param can browse/import. */
  samples: SampleAsset[];
  /** Reveal the Samples library view (offered by an empty sample picker). */
  onRevealSamples?: () => void;
}) {
  const sections = toSections(instrumentSchema(instrumentType));
  const label = catalogEntry(instrumentType).label;
  const sampleContext: SampleContext = {
    assets: samples,
    onImportFile: (file: File) => importSampleFile(file, samples, dispatch),
    onReveal: onRevealSamples,
  };
  return (
    <div className="shrink-0 border border-line rounded-xl bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-[12px] font-semibold text-bright">
        <span className="truncate" title={label}>
          {label}
        </span>
        <span className="ml-auto font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">instr</span>
      </div>
      {/* Sections sit side by side (wrapping when narrow) with a hairline divider, so
          the signal flow is legible like a synth's front panel. */}
      <div className="flex flex-wrap items-stretch gap-x-4 gap-y-3 px-3 py-3">
        {sections.map((section, i) => (
          <div key={section.namespace} className={`flex flex-col gap-2 ${i > 0 ? "pl-4 border-l border-line/60" : ""}`}>
            <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-faint">
              {sectionTitle(section.namespace)}
            </span>
            <div className="flex items-end gap-2">
              {section.specs.map((spec) => (
                <Knob
                  key={spec.id}
                  spec={spec}
                  store={params}
                  variant="slider"
                  onChange={(id, value) => dispatch({ type: "setParam", trackId, id, value })}
                  sampleContext={sampleContext}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
