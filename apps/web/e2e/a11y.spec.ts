import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { expectNoAxeViolations } from "./helpers/a11y";
import { shiftDay } from "./helpers/day";
import { resetDb } from "./helpers/db";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

// axe at every stop a person makes: the login screen, both views, each folded
// panel opened, the composer, the edit form and the confirm dialog — each in
// light and in dark (helpers/a11y.ts). What the stops DO is the golden path's
// business; this only asks whether what they show breaks a WCAG A / AA rule.
// axe sees what is rendered, so a panel has to be open to be checked.

// One 苔片 of every element the Markdown renderer emits (src/markdown.tsx).
const MARKDOWN = [
  "## 見出し",
  "",
  "本文に **強調** と `code` と [リンク](https://example.com/) 。",
  "",
  "- 箇条書き",
  "- [x] 済んだこと",
  "- [ ] これから",
  "",
  "> 引用",
  "",
  "```ts",
  "const moss = 1;",
  "```",
  "",
  "| 石 | 量 |",
  "| :-- | --: |",
  "| a11y | 1 |",
].join("\n");

// The specs share one sqlite and this file sorts first. The golden path starts
// from an empty garden with no user, so give it back that way, pass or fail.
test.afterAll(() => {
  resetDb();
});

test("axe finds no WCAG A / AA violation at any stop, in light or in dark", async ({ page }) => {
  await enableVirtualAuthenticator(page);
  await page.goto("/");
  await page.getByText("初回登録（登録トークンが必要）").click();
  await expectNoAxeViolations(page, "login, 初回登録 open");

  await page.getByLabel("表示名").fill("e2e-a11y");
  await page.getByLabel("登録トークン").fill(E2E_INITIAL_REGISTRATION_TOKEN);
  await page.getByRole("button", { name: "パスキーを作って登録" }).click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();

  // Enough to put something on every surface: both 向き and none, a 続く苔片
  // with a 厚み, two stones on one 苔片 (a bridge), Markdown of every kind.
  const { today } = (await (await page.request.get("/api/posts")).json()) as { today: string };
  const seeded = await page.evaluate(
    async (posts: Record<string, unknown>[]) => {
      const statuses: number[] = [];
      for (const post of posts) {
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(post),
        });
        statuses.push(res.status);
      }
      return statuses;
    },
    [
      { body: MARKDOWN, tags: ["a11y", "軸"], kind: "input" },
      {
        body: "続く苔片",
        tags: ["a11y"],
        kind: "output",
        firstDay: shiftDay(today, -1),
        lastDay: today,
        thickness: 60,
      },
      { body: "向きの無い苔片", tags: ["軸"] },
    ],
  );
  expect(seeded).toEqual([201, 201, 201]);
  await page.reload();

  const feed = page.locator("section.post-feed");
  const timeline = page.locator("ol.posts");
  await expect(timeline.getByText("向きの無い苔片", { exact: true })).toBeVisible();
  await expectNoAxeViolations(page, "投稿一覧");

  // Every folded panel of the view at once: the two settings and the period.
  await page.getByText("パスキー（端末）").click();
  await page.getByText("API トークン（PAT）").click();
  await feed.getByText("期間で絞る").click();
  await expect(feed.getByLabel("開始日")).toBeVisible();
  await expectNoAxeViolations(page, "投稿一覧, 設定と期間 open");

  // A stone chosen: the filter chips, and 付け替え with its fields.
  await timeline.getByRole("button", { name: "「a11y」で絞り込む" }).first().click();
  await page.locator("details.feed-retag summary").click();
  await expect(page.locator(".feed-retag-scope")).toBeVisible();
  await expectNoAxeViolations(page, "投稿一覧, 石で絞って 付け替え open");
  await page.locator(".feed-filter").getByRole("button", { name: "解除" }).click();

  // The edit form in place of a card, its days unfolded.
  const card = timeline.locator("li.post").filter({ hasText: "続く苔片" });
  await card.getByRole("button", { name: "編集", exact: true }).click();
  await card.locator("details.compose-days summary").click();
  await expect(card.getByLabel("〜いつまで")).toBeVisible();
  await expectNoAxeViolations(page, "編集フォーム, 日 open");
  await card.getByRole("button", { name: "やめる" }).click();

  // The confirm dialog (modal: the page behind it is inert).
  await card.getByRole("button", { name: "削除", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "削除する" })).toBeVisible();
  await expectNoAxeViolations(page, "削除の確認");
  await dialog.getByRole("button", { name: "やめる" }).click();
  await expect(dialog).toBeHidden();

  // The composer, with the days and the preview unfolded and the stones offered.
  await page.getByRole("button", { name: "積む", exact: true }).and(page.locator(".fab")).click();
  await dialog.getByLabel("いまの苔片").fill(MARKDOWN);
  await dialog.getByText("プレビュー").click();
  await dialog.getByLabel("いつ", { exact: true }).fill(shiftDay(today, -1));
  await dialog.getByLabel("〜いつまで").fill(today);
  await dialog.getByRole("combobox", { name: "タグ（任意）" }).fill("a");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await expectNoAxeViolations(page, "積むダイアログ");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The other view, with a bar's tip open.
  await page.getByRole("link", { name: "年表", exact: true }).click();
  const yearChart = page.locator("section.tag-timeline");
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await yearChart.locator("li.tl-row").first().locator(".tl-hit").click();
  await expect(yearChart.locator(".tl-tip").first()).toBeVisible();
  await expectNoAxeViolations(page, "年表, 吹き出し open");
});
