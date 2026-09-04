/**
 * Re-lighting a colour without moving its hue.
 *
 * The author palette is a set of hues that identify *people* (see authorColors.ts), and a hue
 * has to stay recognisable in either theme. Lightness does not: a swatch tuned to glow on a
 * near-black ground is barely visible on white. So the hue and chroma are the identity, and
 * the lightness belongs to the theme.
 *
 * sRGB cannot express that split, because changing its channels moves everything at once.
 * OKLab can: it is perceptually uniform, so setting L leaves the colour looking like the same
 * colour, only lighter or darker. Pure maths, no dependency (Björn Ottosson's OKLab).
 *
 * Done in TS rather than CSS `oklch(from ...)` for two reasons: the same value has to reach a
 * canvas (`Waveform` paints resolved pixels, not CSS), and relative colour syntax needs
 * Firefox 128 where the rest of the app only needs 113.
 */

const srgbToLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const linearToSrgb = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;

type Oklab = { L: number; a: number; b: number };

function hexToOklab(hex: string): Oklab {
  const value = parseInt(hex.slice(1), 16);
  const r = srgbToLinear(((value >> 16) & 255) / 255);
  const g = srgbToLinear(((value >> 8) & 255) / 255);
  const b = srgbToLinear((value & 255) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear-light RGB for an Oklab colour. Channels may fall outside 0..1 (out of gamut). */
function oklabToLinearRgb({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: [number, number, number]): boolean =>
  rgb.every((channel) => channel >= -0.0001 && channel <= 1.0001);

const toHex = (rgb: [number, number, number]): string =>
  "#" +
  rgb
    .map((channel) => {
      const byte = Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("");

/**
 * The same colour at a different lightness. `lightness` is OKLab's L, 0 (black) to 1 (white).
 *
 * A hue at its original chroma often has no sRGB answer at a new lightness (a vivid teal
 * cannot stay that vivid at L=0.5), so chroma is reduced until it fits rather than letting
 * the channels clip, which would swing the hue and defeat the point.
 */
export function withLightness(hex: string, lightness: number): string {
  const { a, b } = hexToOklab(hex);
  let low = 0;
  let high = 1;
  // 12 halvings resolves chroma finer than an 8-bit channel can show.
  for (let step = 0; step < 12; step++) {
    const mid = (low + high) / 2;
    if (inGamut(oklabToLinearRgb({ L: lightness, a: a * mid, b: b * mid }))) low = mid;
    else high = mid;
  }
  return toHex(oklabToLinearRgb({ L: lightness, a: a * low, b: b * low }));
}
