import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: unit tests run in plain Node and must
// not boot the Cloudflare plugin (workerd). Domain logic is pure functions, and
// the Hono app is exercised with `app.request(...)` — no bindings needed.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "worker/**/*.test.ts"],
  },
});
