# Web DAW — Project Brief

## Goal
Build an open-source, web-based DAW that isn't bogged down by the constraints of native tools like Ableton Live. Start small and own the core layers (parameter model, DSP, instruments, effects) rather than relying on existing npm packages, since the web has no real plugin ecosystem equivalent to VST/AU.

## Core architectural principle: the parameter schema is the keystone
Everything else is a consumer of one declarative parameter model. Before building any synth or effect, define a schema that describes every parameter: name, range, units, default value, and taper/curve (linear vs exponential). This single object then feeds:

- **UI controls** (knobs, sliders bind to the schema)
- **MCP tools** (get/set is a near-free projection of the schema, not a separate integration)
- **Automation** (parameter changes over time)
- **Patch save/load** (a serialized patch is just a set of schema values)

Designing this first means MCP, automation, and persistence stop being features to integrate later and become views onto a model that already exists. This is the central bet of the project.

## Why build instruments/effects from scratch rather than use existing libraries
- Tone.js and similar libraries are useful for transport/scheduling, but their built-in synths are opinionated and hard to rewire at the signal-flow level.
- There's no "VST for the web", no ecosystem of drop-in third-party plugins. Anything beyond basic Tone.js synths/effects has to be written or ported.
- Owning the DSP and parameter model from day one means full control over what's controllable later (see MCP below), instead of working around someone else's object model.

## Core stack
- **Web Audio API** — the underlying audio graph (oscillators, filters, gain, convolution, etc.).
- **AudioWorklets** — where all custom DSP (synths, effects) runs. Sample-accurate, runs on the audio thread, 128-sample render quantum (~2.9ms at 44.1kHz). Required for real-time performance. The deprecated ScriptProcessorNode is not an option.
- **Scheduling (temporary scaffolding)** — Tone.js is acceptable for transport/clock math in v1, but is scoped as replaceable scaffolding, not a load-bearing dependency. It must not leak into the parameter model or data layer. The canonical lookahead scheduler ("A Tale of Two Clocks": a `setTimeout` loop scheduling ahead off `AudioContext.currentTime`) is ~100 lines and is the expected replacement once it is worth owning.
- **Faust (optional, later)** — a DSP-specific language that compiles to a WASM AudioWorklet *and* an offline reference from a single source. Useful when hand-written DSP needs better performance or cleaner structure, and as a way to eliminate prototype-vs-ship duplication (see prototyping loop). Not needed for v1.

## Real-time constraint
Anything interactive (playing a synth live, turning a knob while it sounds) must run locally in the browser's audio thread. No network round-trip, or latency breaks it. This is non-negotiable for the actual instrument.

**Audio-thread discipline** is part of this constraint, not an afterthought:
- No allocation and no GC pressure inside `process()`. Pre-allocate all buffers.
- Guard against denormals (flush-to-zero, or inject tiny DC) to avoid CPU spikes.
- Smooth/ramp all parameter changes (per-sample smoothing, or `AudioParam` ramps) so discrete sets don't produce zipper noise.

## MCP is a control-plane, not the real-time path
MCP is built in from the start, but its boundary is explicit: **MCP is another client of the parameter model, never a direct line to the audio thread.**

- A set-parameter call travels client → MCP server → browser → main thread → AudioWorklet. This is fine for "set cutoff to 800Hz" or "load patch", but can never carry "turn a knob while it sounds." That stays local (see real-time constraint).
- MCP writes into the same parameter model the UI knobs write into, so smoothing/ramping applies equally to MCP-driven changes.
- **Transport decision (resolve early):** there is no persistent server in a browser tab. The v1 approach is a Node-hosted MCP server holding a WebSocket to the open DAW tab. Implication: the DAW must be open for MCP control to work. Revisit if that constraint becomes limiting.

MCP surface for v1:
- Get/set on every parameter (oscillator settings, filter cutoff, envelope stages, effect parameters), derived directly from the schema.
- Basic transport control (play/stop/tempo).
- Higher-level tools later ("create track," "play note," "load patch").

## Prototyping workflow (shares code with the shipped product)
To avoid drift between an offline reference and the shipped worklet, **the DSP core is written once** as plain JS pure functions over `Float32Array` (per-sample or per-block, no I/O, no allocation). Then:

1. The **offline renderer** imports that module and runs test input through it (via `OfflineAudioContext` or a plain loop), rendering to `.wav` for listening and waveform inspection.
2. The **AudioWorklet** imports the exact same module inside `process()`.

There is no separate "port it later" step for JS DSP, and golden test wavs always describe what actually ships. (Prototyping in a different language like Python/numpy reintroduces the port-and-drift problem, so avoid it; if dual-target DSP is genuinely needed, that is the signal to reach for Faust, which targets both from one source.) Nothing in the shipped product runs DSP server-side.

## Suggested v1 scope
- One AudioWorklet-based synth: simple subtractive, 2 oscillators, filter, ADSR envelope. **Mono or small fixed polyphony** for v1 (full poly voice allocation/stealing is deferred).
- One or two effects (e.g. delay, basic distortion), same AudioWorklet pattern.
- The declarative **parameter schema** for the synth and effects, built first, with UI binding, MCP get/set, and patch save/load all routed through it.
- Note input: computer-keyboard and/or Web MIDI API, including the user-gesture requirement to start the `AudioContext`.
- Minimal sequencer/transport (Tone.js scheduling acceptable here).
- MCP server exposing parameter get/set for the synth and effects, plus basic transport control.

## Explicitly out of scope for v1
- Arrangement view / full timeline UI (significant custom build effort, not core to proving the architecture).
- Plugin format / extensibility for third-party instruments.
- Full polyphony with voice stealing.
- Audio quality matching native tools like Wavetable/Serum. That's a longer-term investment via Faust/WASM if pursued.
