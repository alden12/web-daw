# web-daw

An open-source, web-based DAW that owns its core layers (parameter model, DSP, instruments, effects) instead of leaning on a plugin ecosystem the web doesn't have.

The central bet: **one declarative parameter schema** is the keystone that UI controls, MCP tools, automation, and patch save/load all consume as views. See [docs/BRIEF.md](docs/BRIEF.md) for the full architecture and v1 scope.

<img width="1424" height="1202" alt="Screenshot 2026-06-26 at 15 30 45" src="https://github.com/user-attachments/assets/29450947-7945-4b4c-91df-ffe6d5177e52" />

## Architecture at a glance

- **Web Audio API** for the audio graph; **AudioWorklets** for all custom DSP (sample-accurate, on the audio thread).
- **DSP written once** as plain JS pure functions over `Float32Array`, shared between an offline `.wav` test renderer and the shipped worklet (no port-twice drift).
- **MCP is a control-plane, not the realtime path**: it's another client of the parameter model, never a direct line to the audio thread.
- **Tone.js** is replaceable scaffolding for scheduling only; it must not leak into the data model.

## Stack

Vite + React + TypeScript.

## Development

This project uses [Yarn Classic](https://classic.yarnpkg.com/) (v1).

```bash
yarn             # install dependencies
yarn dev         # start the dev server
yarn build       # type-check and build for production
yarn lint        # lint
yarn test        # run tests
```

## Contributing

Contributions are welcome. By submitting a change you certify the
[Developer Certificate of Origin](CONTRIBUTING.md) by signing off your commits
(`git commit -s`). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[GNU AGPL-3.0-or-later](LICENSE).

In short: the source is open and you are free to use, modify, and self-host it,
but if you run a modified version as a network service you must publish your
changes under the same license. The copyright holder may also offer the project
under a separate commercial license; reach out if the AGPL does not fit your use.
