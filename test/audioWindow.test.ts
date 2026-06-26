import { describe, it, expect } from 'vitest';
import { audioPlayWindow } from '../src/audio/engine/audioWindow';

const DUR = 4; // a 4-second buffer

describe('audioPlayWindow (slide audio under the grid)', () => {
  it('no loop region, no slide -> plays the whole buffer at the onset', () => {
    expect(audioPlayWindow(undefined, undefined, undefined, DUR)).toEqual({
      offset: 0,
      span: DUR,
      delaySec: 0,
    });
  });

  it('a loop region selects that slice (slide 0)', () => {
    expect(audioPlayWindow(1, 3, 0, DUR)).toEqual({ offset: 1, span: 2, delaySec: 0 });
  });

  it('a negative slide moves the buffer left, so a later part plays under the window', () => {
    // window [0,2] on the grid; slide audio left 0.5s -> buffer [0.5, 2.5] plays.
    expect(audioPlayWindow(0, 2, -0.5, DUR)).toEqual({ offset: 0.5, span: 2, delaySec: 0 });
  });

  it('a positive slide pushes the window before the buffer -> a silent head (delay)', () => {
    // window [0,2]; slide audio right 0.5s -> the window head [-0.5,0) is silence,
    // then buffer [0,1.5] plays after a 0.5s delay.
    expect(audioPlayWindow(0, 2, 0.5, DUR)).toEqual({ offset: 0, span: 1.5, delaySec: 0.5 });
  });

  it('clamps the window end to the buffer duration', () => {
    expect(audioPlayWindow(2, 99, 0, DUR)).toEqual({ offset: 2, span: 2, delaySec: 0 });
  });

  it('returns null when the window lands entirely off the buffer (pure silence)', () => {
    // slide the whole buffer far to the right: the window sees only silence.
    expect(audioPlayWindow(0, 2, 10, DUR)).toBeNull();
  });
});
