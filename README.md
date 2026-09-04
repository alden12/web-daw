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

**`yarn dev:mobile` cannot show you this**, for two separate reasons, and each on its own is
enough:

1. **There is no manifest or worker on the dev server.** They are generated for a real build
   only (`devOptions.enabled: false`, so a stale worker can never serve the test suite). Nothing
   is installable there however the origin is served.
2. **A self-signed certificate is not enough.** A browser declines to register a service worker
   on a certificate it does not trust, and says nothing at all about it: no install prompt, no
   error. Fine for everything above, useless here.

**So install it from the deploy**: `yarn deploy`, then open the Fly URL on the phone. Chrome
Android offers **Install app** in its menu, iOS Safari **Share -> Add to Home Screen**.

That is not a workaround for the local setup, it is the shorter path. Serving a build locally
over a certificate a phone will trust means either a tunnel or a private CA, and either way what
you end up testing is a build - so it may as well be the build everyone else gets, on the origin
it will actually run on. The service worker's scope, the manifest's `start_url` and the API it
talks to are all origin-shaped, and only the deploy has the real ones.

Two things that surprise people:

- An installed app is a **separate storage bucket** from the browser tab it was installed from,
  so its OPFS projects start empty. It is a different app as far as the browser is concerned.
- There is **no live reload**. It is a build; rebuild and reload to see a change, and the worker
  hands over the new version on the load after that.

`yarn check:pwa` answers the offline question without a device at all: it serves `dist/`,
installs the worker, cuts the network and asks for a route the browser has never seen. CI runs
it after the build.

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
