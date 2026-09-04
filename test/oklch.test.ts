import { describe, expect, it } from "vitest";
import { withLightness } from "../src/ui/oklch";
import { SWATCHES } from "../src/ui/authorColors";

/**
 * The author palette is a set of hues that identify people, drawn for a near-black ground.
 * On white the same hues fall to 1.9-3.1:1 and stop reading as UI at all, so light mode
 * re-lights them: hue and chroma are the identity, lightness belongs to the theme.
 *
 * These guard the property that made that necessary, not the arithmetic. If someone adds a
 * swatch, or nudges the lightness, the contrast floor is what should catch it.
 */

const LIGHT_GROUND = "#ffffff";
const DARK_GROUND = "#0a0c0e";
/** The value `authorStyle.ts` re-lights to on a white ground. */
const LIGHT_LIGHTNESS = 0.55;

const channel = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((value >> 16) & 255) + 0.7152 * channel((value >> 8) & 255) + 0.0722 * channel(value & 255);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Hue in OKLab terms, as the angle of (a, b). Enough to catch a hue swing. */
function hueDegrees(hex: string): number {
  const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const value = parseInt(hex.slice(1), 16);
  const r = toLinear(((value >> 16) & 255) / 255);
  const g = toLinear(((value >> 8) & 255) / 255);
  const b = toLinear((value & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const aAxis = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return (Math.atan2(bAxis, aAxis) * 180) / Math.PI;
}

describe("the author palette on each ground", () => {
  it("is already legible on the dark ground it was drawn for", () => {
    for (const swatch of SWATCHES) {
      expect(contrast(swatch.hex, DARK_GROUND), `${swatch.name} on dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is NOT legible on white as authored - which is why re-lighting exists", () => {
    // The floor for a UI component is 3:1 (WCAG 1.4.11). Most of the palette misses it.
    const failing = SWATCHES.filter((swatch) => contrast(swatch.hex, LIGHT_GROUND) < 3);
    expect(failing.length, "most swatches are too light for white as drawn").toBeGreaterThan(SWATCHES.length / 2);
  });

  it("clears the 4.5:1 text threshold on white once re-lit", () => {
    for (const swatch of SWATCHES) {
      const relit = withLightness(swatch.hex, LIGHT_LIGHTNESS);
      expect(contrast(relit, LIGHT_GROUND), `${swatch.name} re-lit on white`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("withLightness", () => {
  it("keeps the hue, so an author stays recognisable", () => {
    for (const swatch of SWATCHES) {
      const relit = withLightness(swatch.hex, LIGHT_LIGHTNESS);
      const drift = Math.abs(hueDegrees(relit) - hueDegrees(swatch.hex));
      // A couple of degrees is rounding into 8-bit channels, not a colour change.
      expect(Math.min(drift, 360 - drift), `${swatch.name} hue drift`).toBeLessThan(5);
    }
  });

  it("moves lightness in the direction asked, monotonically", () => {
    const steps = [0.3, 0.45, 0.6, 0.75, 0.9].map((lightness) => luminance(withLightness("#56c7c2", lightness)));
    for (let index = 1; index < steps.length; index++) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1]);
    }
  });

  it("stays inside sRGB by giving up chroma rather than clipping a channel", () => {
    // A vivid hue has no sRGB answer at an extreme lightness. Clipping would swing the hue;
    // reducing chroma keeps it and just desaturates, so near-white stays near-white.
    const nearlyWhite = withLightness("#56c7c2", 0.98);
    expect(/^#[0-9a-f]{6}$/.test(nearlyWhite)).toBe(true);
    expect(contrast(nearlyWhite, LIGHT_GROUND)).toBeLessThan(1.4);
  });
});
