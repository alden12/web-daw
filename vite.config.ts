import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

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
  plugins: [react(), tailwindcss(), ...(mobileHttps ? [basicSsl()] : [])],
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
