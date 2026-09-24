/**
 * A sample trimmed at either end (INST-22): the Sampler's Start skips into it, its Trim end cuts off
 * a tail - a recording that caught silence, a false start or room noise either side of the sound.
 *
 * **A trimmed copy rather than a trimmed playback.** Playing the whole buffer from an offset for a
 * duration would do the cutting, but a cut through a sound clicks, and the source node has no gain
 * of its own to fade with. A copy can carry its own few milliseconds of fade wherever it was cut, and
 * its length is simply the one-shot's length, so nothing else has to know it was trimmed.
 *
 * Copies are cached per buffer, so a knob is not a copy per note. Only the last few settings are
 * kept: turning Trim end sweeps through dozens, and the ones left behind are not coming back.
 */

/** The fade where a sample is cut: long enough not to click, short enough not to be heard. */
const CUT_FADE_SECONDS = 0.003;
/** Trimmed copies kept per sample; older ones are dropped as a knob moves on. */
const CACHED_PER_BUFFER = 4;

const cache = new WeakMap<AudioBuffer, Map<string, AudioBuffer>>();

/**
 * `buffer` less `start` seconds at its head and `end` at its tail, faded in and out where it was
 * cut. The buffer itself when nothing is trimmed. Always at least a frame long, so trimming the whole
 * sample away plays silence rather than failing.
 */
export function trimmedSample(ctx: BaseAudioContext, buffer: AudioBuffer, start: number, end: number): AudioBuffer {
  const from = Math.min(buffer.length - 1, Math.max(0, Math.round(start * buffer.sampleRate)));
  const to = Math.max(from + 1, buffer.length - Math.max(0, Math.round(end * buffer.sampleRate)));
  if (from === 0 && to === buffer.length) return buffer;

  const key = `${from}:${to}`;
  const copies = cache.get(buffer) ?? cache.set(buffer, new Map()).get(buffer)!;
  const cached = copies.get(key);
  if (cached) return cached;

  const trimmed = ctx.createBuffer(buffer.numberOfChannels, to - from, buffer.sampleRate);
  const fadeFrames = Math.min(Math.round(CUT_FADE_SECONDS * buffer.sampleRate), Math.floor((to - from) / 2));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = trimmed.getChannelData(channel);
    data.set(buffer.getChannelData(channel).subarray(from, to));
    // Fade only an end that was cut: an untouched start or end is the sample's own.
    for (let frame = 0; frame < fadeFrames; frame++) {
      const gain = frame / fadeFrames;
      if (from > 0) data[frame] *= gain;
      if (to < buffer.length) data[data.length - 1 - frame] *= gain;
    }
  }

  copies.set(key, trimmed);
  if (copies.size > CACHED_PER_BUFFER) copies.delete(copies.keys().next().value!);
  return trimmed;
}
