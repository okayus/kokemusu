import { expect, test } from "@playwright/test";

// The reload screen, wired as shipped: main.tsx hands createRoot an
// onUncaughtError that renders FatalScreen. The client trusts the shapes the
// API returns (src/api.ts casts, it does not parse), so a response the bundle
// does not expect — a tab left open across a deploy that changed a shape —
// throws while rendering, and React answers by unmounting the whole tree.
//
// /api is stubbed at the network for that: a session, and a timeline whose
// 苔片 has no `tags`. Nothing reaches the Worker, so no account and no D1 row.
test("a render error leaves the reload screen, not a blank page", async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/auth/me") {
      return route.fulfill({ json: { id: "fatal-user", displayName: "e2e" } });
    }
    if (pathname === "/api/posts") {
      return route.fulfill({
        json: { posts: [{ id: "malformed" }], nextCursor: null, today: "2026-01-01" },
      });
    }
    return route.fulfill({ status: 500, json: { error: { type: "internal" } } });
  });

  await page.goto("/");
  const screen = page.getByRole("alert");
  await expect(screen.getByRole("heading", { name: "表示できませんでした" })).toBeVisible();
  // The app is gone, not hidden behind the message.
  await expect(page.locator("header.bar")).toHaveCount(0);

  // 再読み込み is a real reload: with the stubs lifted, the app comes back
  // (no session on this context, so it is the login screen).
  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "再読み込み" }).click();
  await expect(page.getByRole("heading", { name: "苔むす" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
