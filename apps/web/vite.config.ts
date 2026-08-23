import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare({ configPath: "./wrangler.jsonc" })],
  server: {
    // Inside the docker sandbox Vite listens on 5173; the host maps it to 5273.
    port: 5173,
    strictPort: true,
  },
});
