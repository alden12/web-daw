import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import { PWA_MANIFEST } from "./src/pwa/manifest";

/**
 * `MOBILE_HTTPS=1` (i.e. `yarn dev:mobile`) serves the dev server over https with a
 * self-signed certificate, so the app can be opened on a real phone at the laptop's LAN
 * address. That is not cosmetic: a plain-http origin that is not `localhost` is an
 * **insecure context**, and three things the app needs are gated on a secure one -
 * `AudioWorklet` (so nothing plays at all), `navigator.storage` (so persistence silently
 * falls back to memory) and `getUserMedia` (so there is no recording).
 *
 * Off by default. Everyday `yarn dev` stays on http://localhost, which is already a secure
 * context by definition and costs no certificate warning.
 *
 * See "Testing on a phone" in the README.
 */
const mobileHttps = process.env.MOBILE_HTTPS === "1";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(mobileHttps ? [basicSsl()] : []),
    /**
     * Installable, and able to start with no network (MOBILE-3). The offline *data* half is
     * HOST-5's - an OPFS working copy and a durable write queue behind the `BundleStore` seam -
     * so what is left here is the shell: a manifest, and a service worker that has the app's
     * own files before it is asked for them.
     *
     * `prompt` rather than `autoUpdate`, with nothing prompting: a new worker installs in the
     * background and takes over on the next load, instead of calling `skipWaiting` and
     * reloading the page under someone who is in the middle of a take. An in-app "new version"
     * notice is the follow-up that turns the waiting worker into a choice.
     */
    VitePWA({
      registerType: "prompt",
      manifest: PWA_MANIFEST,
      workbox: {
        // The worklets are in here as ordinary `assets/*.js`, and they have to be: without
        // them there is no audio at all, which is a strange way to be offline.
        //
        // Fonts are the one thing filtered rather than swept up. The two families ship a
        // subset per script (adlam, nushu, syriac, math, ...) and `unicode-range` means a
        // browser only ever fetches the ones a glyph needs, which for this UI is latin. Taking
        // all fourteen would put 184KB into the install to cover text the app does not have.
        globPatterns: ["**/*.{js,css,html,svg,png}", "**/*latin*.woff2"],
        // A deep link (`/p/<project>`) is a client-side route, so offline it has to resolve to
        // the shell. The API and the socket are the server's, and answering either from a
        // cache would be worse than failing: the app already knows what to do with a network
        // it cannot reach, and nothing tells it that a stale 200 is not the truth.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws$/],
        cleanupOutdatedCaches: true,
        // Take over the page that installed us, rather than waiting for the next load. This is
        // not `skipWaiting` and does not affect updates: an updated worker still waits its
        // turn. It only decides whether the *first* visit ends up covered, and "install it,
        // then walk into a lift" should not need a reload nobody knows to perform.
        clientsClaim: true,
      },
      /**
       * Off in dev and in the e2e run, which uses the dev server: a worker serving yesterday's
       * bundle to a test suite is a class of flake worth never having.
       *
       * The consequence is worth stating, because it is not obvious and it wastes an
       * afternoon: **there is no manifest and no worker on the dev server at all**, so the app
       * is not installable there however the origin is served. Trying the installed app means
       * a deployed build; `yarn check:pwa` is the local answer for whether it works offline.
       */
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5155,
    ...(mobileHttps
      ? {
          // Tunnels (cloudflared, ngrok) address the dev server by hostname rather than
          // IP, and Vite rejects unknown hosts by default.
          allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io"],
          // Fail rather than wander to the next free port. The URL here is typed into a
          // phone by hand, so a silent drift to 5156 means the address you remember now
          // points at whatever still holds 5155 - most likely an orphaned earlier run,
          // which answers, so it looks like your changes simply had no effect.
          strictPort: true,
        }
      : {}),
  },
});
