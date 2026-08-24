import type { Bindings } from "./types";

// ≥ 32 chars so getSessionSecret accepts it.
export const TEST_SECRET = "unit-test-session-secret-0123456789abcdef";

export const TEST_ORIGIN = "http://localhost:5273";

// `Bindings[K] | undefined` (not Partial) so a test can explicitly UNSET an
// optional binding: `testEnv({ SESSION_SECRET: undefined })`.
type EnvOverrides = { [K in keyof Bindings]?: Bindings[K] | undefined };

/**
 * Bindings for Node unit tests. DB is absent on purpose — a test that reaches
 * D1 must fail loudly here; DB-backed flows belong to e2e (PR6) and the
 * production verification. ASSETS is a stub SPA response for fallback tests.
 */
export function testEnv(overrides: EnvOverrides = {}): Bindings {
  const base: Bindings = {
    DB: undefined as unknown as D1Database,
    ASSETS: {
      fetch: () =>
        Promise.resolve(
          new Response("<!doctype html><html><body>spa</body></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
        ),
    } as unknown as Fetcher,
    RP_ID: "localhost",
    ORIGIN: TEST_ORIGIN,
    SESSION_SECRET: TEST_SECRET,
  };
  return { ...base, ...overrides } as Bindings;
}
