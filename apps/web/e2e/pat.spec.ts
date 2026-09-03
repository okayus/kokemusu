import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { queryRows } from "./helpers/db";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

// The PAT vertical slice (features.md §7, ADR-0002), wired end to end: mint in
// the settings UI → a cookie-free sender posts a 苔片 with Bearer only (no
// Origin — the CSRF exemption) → the write-only wall (post:write reads
// nothing, and a PAT can never mint a PAT) → the PAT is judged before a riding
// cookie → revoke in the UI kills it. Every REJECTED request is sent without a
// body on purpose — wrangler dev's proxy turns an unread request body into a
// 500-then-exit on the next request (e2e/README.md); production doesn't care.
test("PAT: mint → Bearer post lands encrypted → write-only wall → revoke kills it", async ({
  page,
  playwright,
  baseURL,
}) => {
  await enableVirtualAuthenticator(page);

  // Works standalone (fresh DB → new user) and after golden-path (the
  // single-user rule adds this passkey to the existing user).
  await page.goto("/");
  await page.getByText("初回登録（登録トークンが必要）").click();
  await page.getByLabel("表示名").fill("e2e-pat");
  await page.getByLabel("登録トークン").fill(E2E_INITIAL_REGISTRATION_TOKEN);
  await page.getByRole("button", { name: "パスキーを作って登録" }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();

  // Mint. The raw token appears exactly here, once.
  await page.getByText("API トークン（PAT）").click();
  await page.getByLabel("トークン名").fill("e2e-sender");
  await page.getByRole("button", { name: "発行" }).click();
  const shown = page.locator(".token-once code");
  await expect(shown).toBeVisible();
  const raw = (await shown.textContent()) ?? "";
  expect(raw).toMatch(/^kokemusu_pat_[A-Za-z0-9_-]{43}$/);

  // At rest the credential is sha256 hex — the raw token never reached D1.
  const atRest = queryRows<{ token_hash: string; name: string }>(
    "SELECT token_hash, name FROM api_token",
  );
  expect(atRest).toHaveLength(1);
  expect(atRest[0]?.name).toBe("e2e-sender");
  expect(atRest[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);

  // The sender's view of the world: a fresh context with NO cookie jar — only
  // the Bearer header, and never an Origin (a CLI/Worker can't send ours).
  const sender = await playwright.request.newContext({ baseURL: baseURL ?? "" });
  const bearer = { Authorization: `Bearer ${raw}` };

  // whoami smoke — the same check mazuoboeru runs after configuring its secret.
  const me = await sender.get("/api/auth/me", { headers: bearer });
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { id: string }).id).toBeTruthy();

  // The daily-post shape: same body as the composer, plus the optional title.
  const created = await sender.post("/api/posts", {
    headers: bearer,
    data: { title: "まず覚える 2026-09-03", body: "PAT からの苔片", tags: ["mazuoboeru"] },
  });
  expect(created.status()).toBe(201);

  // The write-only wall: post:write cannot read the decrypted timeline…
  expect((await sender.get("/api/posts", { headers: bearer })).status()).toBe(403);
  // …and a PAT can never mint another PAT.
  const mintAttempt = await sender.post("/api/tokens", { headers: bearer });
  expect(mintAttempt.status()).toBe(403);
  expect(((await mintAttempt.json()) as { error: { type: string } }).error.type).toBe(
    "session_required",
  );

  // The PAT is judged BEFORE the cookie: through the page's own context (cookie
  // jar + Bearer) the same read is still the token's 403, not the session's 200.
  expect((await page.request.get("/api/posts", { headers: bearer })).status()).toBe(403);

  // Junk without the kokemusu_pat_ prefix slips past CSRF (Bearer present) and
  // dies at auth as a plain 401 — cheap, before any D1 read.
  expect(
    (await sender.post("/api/posts", { headers: { Authorization: "Bearer junk" } })).status(),
  ).toBe(401);

  // The sender's 苔片 lands in the owner's UI, decrypted — title included…
  await page.reload();
  const timeline = page.locator("ol.posts");
  await expect(timeline.getByText("PAT からの苔片", { exact: true })).toBeVisible();
  await expect(timeline.locator(".post-title").first()).toHaveText("まず覚える 2026-09-03");
  await expect(timeline.locator(".post-tags .tag-chip").first()).toHaveText("mazuoboeru");

  // …while at rest title and body are k1. envelopes like every other 苔片.
  const storedPost = queryRows<{ title: string; body: string }>(
    "SELECT title, body FROM post WHERE title IS NOT NULL",
  );
  expect(storedPost).toHaveLength(1);
  expect(storedPost[0]?.title).toMatch(/^k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(storedPost[0]?.body).toMatch(/^k1\./);
  expect(storedPost[0]?.body).not.toContain("苔片");

  // Revoke in the settings UI. The row stays, marked dead.
  await page.getByText("API トークン（PAT）").click();
  await page.getByRole("button", { name: "失効" }).click();
  await expect(page.getByText("失効済み")).toBeVisible();

  // The revoked token is gone for the sender — reads and writes alike.
  expect((await sender.post("/api/posts", { headers: bearer })).status()).toBe(401);
  expect((await sender.get("/api/auth/me", { headers: bearer })).status()).toBe(401);

  await sender.dispose();
});
