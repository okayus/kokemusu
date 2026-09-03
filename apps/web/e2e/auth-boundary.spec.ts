import { expect, test } from "@playwright/test";

// The session gate, seen from outside. Every /api route other than the public
// auth ceremonies answers 401 JSON to a request without a session — reads,
// writes, and paths that do not exist (the protected catch-all sits BEHIND the
// session middleware, so an unauthenticated probe cannot even learn which routes
// exist). The public routes must stay public: mounting them after the guard
// would turn login/begin into a 401 (the mount-order comment in
// worker/index.ts). The `request` fixture is a fresh context with no cookies.
const UNAUTHORIZED = { error: { type: "unauthorized" } };

test("without a session every /api read is 401 JSON, never the SPA", async ({ request }) => {
  for (const path of [
    "/api/auth/me",
    "/api/auth/credentials",
    "/api/posts",
    "/api/tags",
    "/api/stats/heatmap",
    "/api/does-not-exist",
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
    expect(res.headers()["content-type"], path).toContain("application/json");
    expect(await res.json(), path).toEqual(UNAUTHORIZED);
  }
});

test("without a session, writes are refused by the session gate itself", async ({
  request,
  baseURL,
}) => {
  // Same-origin Origin so the CSRF check passes and it is the SESSION that says no.
  // No request body, on purpose: the gate answers before the body would be read,
  // and wrangler dev's proxy turns an UNREAD request body into a "Network
  // connection lost" 500 on the NEXT request, then exits (verified with wrangler
  // 4.125.0 and 4.128.0, 2026-09-02 — e2e/README.md). Production workerd does not
  // care, so this is a rule for the specs, not for the Worker.
  const headers = { Origin: baseURL ?? "" };
  const post = await request.post("/api/posts", { headers });
  expect(post.status()).toBe(401);
  expect(await post.json()).toEqual(UNAUTHORIZED);
  const patch = await request.patch("/api/posts/some-id", { headers });
  expect(patch.status()).toBe(401);
  const del = await request.delete("/api/posts/some-id", { headers });
  expect(del.status()).toBe(401);
  const logout = await request.post("/api/auth/logout", { headers });
  expect(logout.status()).toBe(401);
  const addDevice = await request.post("/api/auth/credentials/add/begin", { headers });
  expect(addDevice.status()).toBe(401);
});

test("a forged cookie is 401, a wrong registration token is 403, login/begin stays public", async ({
  request,
  baseURL,
}) => {
  const forged = await request.get("/api/auth/me", {
    headers: { Cookie: "session=not-a-signed-jwt" },
  });
  expect(forged.status()).toBe(401);
  expect(await forged.json()).toEqual(UNAUTHORIZED);

  const headers = { Origin: baseURL ?? "" };
  const begin = await request.post("/api/auth/register/begin", {
    headers,
    data: { displayName: "nobody", initialRegistrationToken: "not-the-token" },
  });
  expect(begin.status()).toBe(403);
  expect(await begin.json()).toEqual({ error: { type: "registration_closed" } });

  // Public, and answering for the e2e relying party — the vars the prepared
  // config carries, not the production RP_ID pinned in wrangler.jsonc.
  const login = await request.post("/api/auth/login/begin", { headers });
  expect(login.status()).toBe(200);
  const { options } = (await login.json()) as { options: { challenge: string; rpId: string } };
  expect(options.challenge).toBeTruthy();
  expect(options.rpId).toBe("localhost");
});
