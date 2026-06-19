# web-daw

An open-source, web-based DAW that owns its core layers (parameter model, DSP, instruments, effects) instead of leaning on a plugin ecosystem the web doesn't have.

The central bet: **one declarative parameter schema** is the keystone that UI controls, MCP tools, automation, and patch save/load all consume as views. See [docs/BRIEF.md](docs/BRIEF.md) for the full architecture and v1 scope.

## Architecture at a glance

- **Web Audio API** for the audio graph; **AudioWorklets** for all custom DSP (sample-accurate, on the audio thread).
- **DSP written once** as plain JS pure functions over `Float32Array`, shared between an offline `.wav` test renderer and the shipped worklet (no port-twice drift).
- **MCP is a control-plane, not the realtime path**: it's another client of the parameter model, never a direct line to the audio thread.
- **Tone.js** is replaceable scaffolding for scheduling only; it must not leak into the data model.

## Stack

Vite + React + TypeScript.

## Development

```bash
npm install      # install dependencies
npm run dev      # start the dev server
npm run build    # type-check and build for production
npm run lint     # lint
```

## License

[MIT](LICENSE)
