import { describe, expect, it } from "vitest";
import { FACTORY_PATCHES } from "../src/audio/patches/factory";
import { hasInstrument, instrumentSchema } from "../src/audio/instruments/catalog";
import { hasEffect, effectSchema } from "../src/audio/effects/catalog";
import type { ParamSchema, ParamValue } from "../src/audio/params/types";

/** Assert every set value names a real param and (for numbers) sits in range. */
function expectValuesValid(schema: ParamSchema, values: Record<string, ParamValue>, label: string) {
  for (const [id, value] of Object.entries(values)) {
    const spec = schema.find((candidate) => candidate.id === id);
    expect(spec, `${label}: unknown param "${id}"`).toBeTruthy();
    if (spec?.kind === "number") {
      expect(typeof value, `${label}: ${id} should be a number`).toBe("number");
      expect(value as number, `${label}: ${id} below min`).toBeGreaterThanOrEqual(spec.min);
      expect(value as number, `${label}: ${id} above max`).toBeLessThanOrEqual(spec.max);
    }
  }
}

describe("factory patches", () => {
  it("all reference a real instrument and stay within its schema", () => {
    for (const patch of FACTORY_PATCHES) {
      expect(hasInstrument(patch.instrumentType), `${patch.name}: unknown instrument`).toBe(true);
      expectValuesValid(instrumentSchema(patch.instrumentType), patch.params, patch.name);
    }
  });

  it("all bundled effects are real and within their schema", () => {
    for (const patch of FACTORY_PATCHES) {
      for (const effect of patch.effects) {
        expect(hasEffect(effect.type), `${patch.name}: unknown effect "${effect.type}"`).toBe(true);
        expectValuesValid(effectSchema(effect.type), effect.params, `${patch.name}/${effect.type}`);
      }
    }
  });

  it("are all built-in, categorized, and uniquely identified", () => {
    const ids = new Set<string>();
    for (const patch of FACTORY_PATCHES) {
      expect(patch.builtin, `${patch.name}: should be builtin`).toBe(true);
      expect(patch.category, `${patch.name}: needs a category`).toBeTruthy();
      expect(ids.has(patch.id), `${patch.name}: duplicate id ${patch.id}`).toBe(false);
      ids.add(patch.id);
    }
  });
});
