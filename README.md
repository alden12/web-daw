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
yarn dev:mobile  # serve over https on the LAN, for testing on a real device
yarn build       # type-check and build for production
yarn lint        # lint
yarn test        # run tests
```

### Testing on a phone or tablet

Use `yarn dev:mobile` and open the `https://<lan-ip>:5155/` address it prints. Do **not**
just use `yarn dev --host`: an origin that is plain http and is not `localhost` is an
**insecure context**, and three things the app depends on are gated on a secure one.

| API | Gated | Symptom on plain http |
| --- | --- | --- |
| `AudioWorklet` | yes | nothing plays; the start dialog now says why |
| `navigator.storage` (OPFS) | yes | persistence silently falls back to memory |
| `getUserMedia` | yes | no mic recording |
| `crypto.randomUUID` | yes | (handled - see `src/audio/randomUuid.ts`) |

The certificate is self-signed, so the device shows a warning once: on iOS, **Show Details
-> visit this website**; on Android Chrome, **Advanced -> Proceed**. The certificate is
cached, so this is a one-off per device rather than per run.

`ERR_EMPTY_RESPONSE` means the browser asked for `http://` and the server only speaks TLS -
usually the address bar autocompleting a remembered plain-http URL. Type the `https://`
prefix explicitly.

`dev:mobile` runs in Vite's `test` mode, which loads the committed `.env.test` and so blanks
`VITE_SUPABASE_*` and `VITE_DAW_API_URL`. That skips the login gate and persists locally to
OPFS, which is what you want for UI work. To exercise the real backend from a device instead,
run `MOBILE_HTTPS=1 yarn dev --host` so your own `.env` applies.

If the device cannot reach the laptop at all (client isolation on the network), tunnel
instead - `cloudflared tunnel --url https://localhost:5155` - the tunnel hostnames are
already in `allowedHosts`.

### Installing it as an app

The app is installable (MOBILE-3): a manifest, icons, and a service worker that precaches the
whole shell so it starts with no network.

**`yarn dev:mobile` is not enough for this one.** A browser refuses to register a service
worker on an origin whose certificate it does not trust, and it does so quietly - no install
prompt, no error. A self-signed certificate is fine for everything above and useless here.
Three ways round it, cheapest first:

- **A tunnel.** `cloudflared tunnel --url https://localhost:5155` gives a real certificate on
  a `trycloudflare.com` hostname, which is already in `allowedHosts`. Live reload still works,
  so this is the one to use while building.
- **Deploy it.** `yarn deploy` and open the Fly URL. What the world would get.
- **`mkcert`**, with its root certificate installed on the device. Worth it if you do this
  often; a faff for one afternoon.

Then: Chrome Android offers **Install app** in its menu, iOS Safari **Share -> Add to Home
Screen**. Note that an installed app is a *separate storage bucket* from the browser tab it
was installed from, so its OPFS projects start empty.

`yarn check:pwa` answers the only question that matters here without a device: it builds,
serves `dist/`, installs the worker, cuts the network and asks for a route the browser has
never seen. CI runs it.

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
