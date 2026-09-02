import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { queryRows } from "./helpers/db";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

type HeatmapWire = {
  from: string;
  to: string;
  days: { day: string; count: number; level: number }[];
};

// The vertical slice, wired end to end: token-gated passkey registration (a real
// WebAuthn ceremony against a CDP virtual authenticator — no DEV_BYPASS) → the
// session survives a reload → one 苔片 with two tags → the timeline shows it
// decrypted and today's cell of the 総草 goes from level 0 to level 1, on the
// wire and on screen → still there after a reload (D1 committed, BODY_KEY
// round-trips) → logout → login with the passkey just registered. What each step
// MEANS is unit-tested; this proves the pieces are connected the way production
// connects them.
test("register → post → today's moss darkens → reload → logout → login", async ({ page }) => {
  await enableVirtualAuthenticator(page);

  await page.goto("/");
  await page.getByText("初回登録（登録トークンが必要）").click();
  await page.getByLabel("表示名").fill("e2e-gardener");
  await page.getByLabel("登録トークン").fill(E2E_INITIAL_REGISTRATION_TOKEN);
  await page.getByLabel("この端末の名前（任意）").fill("virtual authenticator");
  await page.getByRole("button", { name: "パスキーを作って登録" }).click();

  const garden = page.getByText("e2e-gardener の庭。");
  await expect(garden).toBeVisible();

  // A fresh D1 (global-setup): the 総草 renders with nothing on it, today included.
  const total = page.locator(".heatmap-total");
  const today = page.locator("rect.heatmap-cell.today");
  await expect(total).toHaveText("計 0 片");
  await expect(today).toHaveClass(/\bl0\b/);

  // The session cookie, not React state, is what keeps us logged in.
  await page.reload();
  await expect(garden).toBeVisible();

  const body = `e2e の苔片 ${Date.now()}`;
  await page.getByLabel("いまの苔片").fill(body);
  await page.getByLabel("タグ（コンマ区切り・任意）").fill("e2e, 苔");
  await page.getByRole("button", { name: "積む" }).click();

  const timeline = page.locator("ol.posts");
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await expect(timeline.locator("li.tag")).toHaveText(["e2e", "苔"]);

  // DoD 4, on screen and on the wire: exactly one step darker, and only today.
  await expect(total).toHaveText("計 1 片");
  await expect(today).toHaveClass(/\bl1\b/);
  const heatmap = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(heatmap.days.at(-1)).toEqual({ day: heatmap.to, count: 1, level: 1 });
  expect(heatmap.days.reduce((n, d) => n + d.count, 0)).toBe(1);

  // 石の年表 (visualization.md §8): the two stones appear as one row each, and
  // tapping a stone opens its 内訳年表 — the stone alone plus stone × 共起タグ.
  const yearChart = page.locator("section.tag-timeline");
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await expect(yearChart.locator(".tl-note").first()).toHaveText("1 片 · 1.0日/片");
  await yearChart.getByRole("button", { name: "e2e", exact: true }).click();
  await expect(yearChart.getByText("「e2e」の内訳")).toBeVisible();
  const focusRows = yearChart.locator("li.tl-row");
  await expect(focusRows).toHaveCount(2);
  await expect(focusRows.nth(1).getByRole("button", { name: "苔", exact: true })).toBeVisible();
  await yearChart.getByRole("button", { name: "すべての石へ" }).click();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);

  // The third form on the wire — `?tags=` (タグ集合 AND) has no UI shortcut with
  // only two stones, so prove the SQL against the real sqlite here: both stones
  // together = exactly the one 苔片, echoed in request order.
  type TimelineWire = { today: string; rows: { tags: { id: string }[]; count: number }[] };
  const all = (await (await page.request.get("/api/stats/timeline")).json()) as TimelineWire;
  const stoneIds = all.rows.map((r) => r.tags[0]?.id ?? "");
  expect(stoneIds).toHaveLength(2);
  const combined = (await (
    await page.request.get(`/api/stats/timeline?tags=${stoneIds.join(",")}`)
  ).json()) as TimelineWire;
  expect(combined.rows).toHaveLength(1);
  expect(combined.rows[0]?.count).toBe(1);
  expect(combined.rows[0]?.tags.map((t) => t.id)).toEqual(stoneIds);

  // At rest it is a `k1.<iv>.<ciphertext>` envelope (ADR-0001), never the text —
  // the DoD 5 check, read from the sqlite itself rather than through the API.
  const stored = queryRows<{ body: string; title: string | null }>("SELECT body, title FROM post");
  expect(stored).toHaveLength(1);
  expect(stored[0]?.body).toMatch(/^k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(stored[0]?.body).not.toContain("苔片");
  expect(stored[0]?.title).toBeNull();

  // Persisted — and decrypted on the way back.
  await page.reload();
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await expect(today).toHaveClass(/\bl1\b/);

  await page.getByRole("button", { name: "ログアウト" }).click();
  const loginButton = page.getByRole("button", { name: "パスキーでログイン" });
  await expect(loginButton).toBeVisible();
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);

  // Discoverable credential: no username asked, the authenticator offers the passkey.
  await loginButton.click();
  await expect(garden).toBeVisible();
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
});
