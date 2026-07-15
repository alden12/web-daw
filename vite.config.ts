import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { agentProxyConfig, agentProxyPlugin } from "./server/agentProxy";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env with no prefix filter so the server-side agent key is available to the
  // proxy middleware. These are NOT exposed to the client bundle - Vite only inlines
  // VITE_-prefixed vars, and the key is deliberately not one (see docs/AGENT.md).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), agentProxyPlugin(agentProxyConfig(env))],
    server: {
      port: 5155,
    },
  };
});
