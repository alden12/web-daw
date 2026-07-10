/**
 * The drum kit's device panel: a bank of pads instead of a synth's knob sections.
 * Still fully schema-driven (it reads the `pad{n}.*` specs and the env/amp sections
 * from the drumkit schema and renders them with the generic Knob/SamplePicker) - but
 * laid out compactly per pad: a title row with the pad's note selector, the sample
 * picker + adder, then horizontal Level/Tune faders. Only the pads in use are shown
 * (loaded, plus one you're adding via "Add pad"), so a fresh kit isn't a wall of empty
 * slots. Chosen for drumkit tracks in place of the generic InstrumentPanel, the same
 * way the step grid / drum roll are chosen over the piano roll.
 */
import { useState } from "react";
import type { ParamStore } from "../audio/params/store";
import type { ParamSpec } from "../audio/params/types";
import type { Dispatch } from "../audio/commands/types";
import type { ProjectStore } from "../audio/project/projectStore";
import { paramKey } from "../audio/commands/authorship";
import type { SampleAsset } from "../audio/samples/catalog";
import { instrumentSchema } from "../audio/instruments/catalog";
import { importSampleFile } from "../audio/samples/importSample";
import { Knob, type SampleContext } from "./Knob";
import { SamplePicker } from "./SamplePicker";
import { toSections, sectionTitle, padNumber } from "./paramSections";
import { usePads } from "./useDrumPads";

export function DrumkitPanel({
  params,
  trackId,
  dispatch,
  samples,
  onRevealSamples,
  projectStore,
}: {
  params: ParamStore;
  trackId: string;
  dispatch: Dispatch;
  samples: SampleAsset[];
  onRevealSamples?: () => void;
  /** Supplies per-param last-editor authorship for the knob tint. */
  projectStore: ProjectStore;
}) {
  const pads = usePads(params);
  const sections = toSections(instrumentSchema("drumkit"));
  const padSections = sections.filter((section) => padNumber(section.namespace));
  const otherSections = sections.filter((section) => !padNumber(section.namespace));

  // Show loaded pads plus any revealed via "Add pad": a pad slot appears once it has a
  // sample (so reloading a saved kit shows exactly its pads) or once you reveal it.
  const highestLoaded = pads.reduce(
    (max, pad) => (pad.ref !== "" && pad.ref !== "none" ? Math.max(max, pad.index) : max),
    -1,
  );
  const [revealed, setRevealed] = useState(0);
  const shownCount = Math.min(padSections.length, Math.max(1, highestLoaded + 1, revealed));

  const setParam = (id: string, value: number | string | boolean) => dispatch({ type: "setParam", trackId, id, value });
  const sampleContext: SampleContext = {
    assets: samples,
    onImportFile: (file: File) => importSampleFile(file, samples, dispatch),
    onReveal: onRevealSamples,
  };
  const rowControl = (spec: ParamSpec) => (
    <Knob
      key={spec.id}
      spec={spec}
      store={params}
      variant="row"
      onChange={setParam}
      sampleContext={sampleContext}
      author={projectStore.authorOf(paramKey(trackId, spec.id))}
    />
  );

  return (
    <div className="shrink-0 border border-line rounded-xl bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line text-[12px] font-semibold text-bright">
        <span className="truncate" title="Drum Kit">
          Drum Kit
        </span>
        <span className="ml-auto font-mono text-[9px] tracking-wider uppercase text-faint shrink-0">instr</span>
      </div>
      <div className="flex flex-col gap-3 px-3 py-3">
        {/* Kit-wide controls (envelope, amp) as a horizontal strip above the pads. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {otherSections.map((section) => (
            <div key={section.namespace} className="flex items-center gap-3">
              <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-faint">
                {sectionTitle(section.namespace)}
              </span>
              <div className="flex items-center gap-3">
                {section.specs.map((spec) => (
                  <div key={spec.id} className="w-40">
                    {rowControl(spec)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
          {padSections.slice(0, shownCount).map((section) => {
            const padIndex = Number(padNumber(section.namespace)) - 1;
            const noteSpec = section.specs.find((spec) => spec.id.endsWith(".note"));
            const sampleSpec = section.specs.find((spec) => spec.kind === "sample");
            const faders = section.specs.filter((spec) => spec.kind === "number" && !spec.id.endsWith(".note"));
            return (
              <div key={section.namespace} className="flex flex-col gap-1.5 w-44 rounded-lg border border-line/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-faint">
                    {sectionTitle(section.namespace)}
                  </span>
                  {noteSpec && (
                    <Knob
                      spec={noteSpec}
                      store={params}
                      variant="row"
                      hideLabel
                      onChange={setParam}
                      author={projectStore.authorOf(paramKey(trackId, noteSpec.id))}
                    />
                  )}
                </div>
                {sampleSpec && (
                  <SamplePicker
                    spec={sampleSpec}
                    value={pads[padIndex]?.ref ?? ""}
                    onChange={setParam}
                    assets={samples}
                    onImportFile={sampleContext.onImportFile}
                    onReveal={sampleContext.onReveal}
                    hideLabel
                  />
                )}
                {faders.map(rowControl)}
              </div>
            );
          })}
          {shownCount < padSections.length && (
            <button
              type="button"
              onClick={() => setRevealed(shownCount + 1)}
              title="Add another pad"
              className="self-stretch shrink-0 flex flex-col items-center justify-center gap-1 w-16 rounded-lg border border-dashed border-line text-muted hover:text-ink hover:border-you/55 cursor-pointer"
            >
              <span className="text-lg leading-none">+</span>
              <span className="font-mono text-[9px] uppercase tracking-wide">Add pad</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
