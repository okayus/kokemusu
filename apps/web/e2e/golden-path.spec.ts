import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { executeSql, queryRows } from "./helpers/db";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

type HeatmapWire = {
  from: string;
  to: string;
  days: { day: string; count: number; level: number }[];
};

type PostsWire = { posts: { body: string; day: string }[]; today: string };

/** A `YYYY-MM-DD` key moved by whole days — civil math on the UTC carrier, like the app's own. */
const shiftDay = (day: string, days: number) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + days))
    .toISOString()
    .slice(0, 10);

const slashed = (day: string) => day.replaceAll("-", "/");

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
  await expect(timeline.locator(".post-tags .tag-chip")).toHaveText(["e2e", "苔"]);

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

  // 石のつながり (visualization.md §6): two stones on one 苔片 = one bridge, and
  // tapping a stone lands on the §8 focus 年表 (2026-09-03 決定 — the graph's
  // node tap is wired to the timeline's focus, not a page of its own).
  const graphChart = page.locator("section.tag-graph");
  await expect(graphChart.locator(".tg-node")).toHaveCount(2);
  await expect(graphChart.locator(".tg-edge")).toHaveCount(1);
  // exact — the bridge button's name ("e2e × 苔 · 1 片") contains this too.
  await graphChart.getByRole("button", { name: "苔 · 1 片", exact: true }).click();
  await expect(yearChart.getByText("「苔」の内訳")).toBeVisible();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await yearChart.getByRole("button", { name: "すべての石へ" }).click();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);

  // §6 on the wire, against the real sqlite: the self-join sees the one pair
  // (with `a` < `b`), and the JST period filter keeps a 苔片 posted "today"
  // inside 今月.
  type GraphWire = {
    nodes: { id: string; name: string; count: number }[];
    edges: { a: string; b: string; count: number }[];
  };
  const graph = (await (await page.request.get("/api/stats/graph")).json()) as GraphWire;
  expect(graph.nodes.map((n) => [n.name, n.count]).sort()).toEqual([
    ["e2e", 1],
    ["苔", 1],
  ]);
  const pair = graph.nodes.map((n) => n.id).sort();
  expect(graph.edges).toEqual([{ a: pair[0], b: pair[1], count: 1 }]);
  const monthGraph = (await (
    await page.request.get("/api/stats/graph?period=month")
  ).json()) as GraphWire;
  expect(monthGraph.nodes).toHaveLength(2);
  expect(monthGraph.edges).toHaveLength(1);

  // The third form on the wire — `?tags=` (タグ集合 AND) has no UI shortcut with
  // only two stones, so prove the SQL against the real sqlite here: both stones
  // together = exactly the one 苔片, echoed in request order.
  type TimelineWire = {
    today: string;
    rows: { tags: { id: string }[]; count: number; months: { month: string; count: number }[] }[];
  };
  const all = (await (await page.request.get("/api/stats/timeline")).json()) as TimelineWire;
  const stoneIds = all.rows.map((r) => r.tags[0]?.id ?? "");
  expect(stoneIds).toHaveLength(2);
  const combined = (await (
    await page.request.get(`/api/stats/timeline?tags=${stoneIds.join(",")}`)
  ).json()) as TimelineWire;
  expect(combined.rows).toHaveLength(1);
  expect(combined.rows[0]?.count).toBe(1);
  expect(combined.rows[0]?.tags.map((t) => t.id)).toEqual(stoneIds);

  // 月セグメント棒 (visualization.md §8): every form carries each row's 活動月 —
  // this JST month, the one 苔片 — folded in core from the raw axis, against
  // the real sqlite; on screen the bar paints one segment per row.
  const thisMonth = [{ month: all.today.slice(0, 7), count: 1 }];
  expect(all.rows.map((r) => r.months)).toEqual([thisMonth, thisMonth]);
  expect(combined.rows[0]?.months).toEqual(thisMonth);
  const focused = (await (
    await page.request.get(`/api/stats/timeline?focus=${stoneIds[0] ?? ""}`)
  ).json()) as TimelineWire;
  expect(focused.rows.map((r) => r.months)).toEqual([thisMonth, thisMonth]);
  await expect(yearChart.locator("rect.tl-month")).toHaveCount(2);

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

  // タグ絞り込み (features.md §3): a second 苔片 carrying only "e2e" makes the
  // filter observable — 2 苔片 open, 1 behind any 苔-filter. All three 導線
  // land on the same feed, and both wire forms run against the real sqlite.
  // Its body is Markdown, so the same 苔片 also carries the 描画 checks below.
  const markdownBody = [
    "絞り込み用の苔片",
    "",
    "## 見出し",
    "",
    "- 箇条書き",
    "",
    "`コード` と [リンク](https://example.test/) と <b>生 HTML</b> と [罠](javascript:alert(1))",
  ].join("\n");
  await page.getByLabel("いまの苔片").fill(markdownBody);

  // コンポーザのプレビューは苔片の表示と同じ描画器を通る — ここで見えるものが積まれる。
  const composer = page.locator("form.composer");
  await composer.locator("summary").click();
  const preview = composer.locator(".md-preview .md");
  await expect(preview.locator("h4")).toHaveText("見出し");
  await expect(preview.locator("li")).toHaveText("箇条書き");

  await page.getByLabel("タグ（コンマ区切り・任意）").fill("e2e");
  await page.getByRole("button", { name: "積む" }).click();
  await expect(timeline.locator("li.post")).toHaveCount(2);

  // Markdown + サニタイズ (security.md / ADR-0004), against the production
  // bundle and the production CSP: the body went through AES-GCM to D1 and
  // back, and comes out as ELEMENTS — while 生 HTML stays text and a
  // `javascript:` href never becomes a link. The unit tests say what the
  // renderer does; this says the real 苔片 is rendered by it.
  // 一覧は新しい順なので、いま積んだ 2 つ目が先頭。以降もこの手で掴む — 編集フォームを
  // 開くと本文は textarea の中へ移り、hasText では掴めなくなる。
  const second = timeline.locator("li.post").first();
  const secondBody = second.locator(".post-body");
  await expect(secondBody.locator("h4")).toHaveText("見出し");
  await expect(secondBody.locator("li")).toHaveText("箇条書き");
  await expect(secondBody.locator("code")).toHaveText("コード");
  const mdLink = secondBody.locator("a");
  await expect(mdLink).toHaveCount(1);
  await expect(mdLink).toHaveAttribute("href", "https://example.test/");
  await expect(mdLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(secondBody.locator("b")).toHaveCount(0);
  await expect(secondBody).toContainText("<b>生 HTML</b>");
  await expect(secondBody).toContainText("罠");

  // 導線 1 — a 苔片's own chip: one stone, filtered by name (?tag=).
  await timeline.getByRole("button", { name: "「苔」で絞り込む" }).click();
  await expect(page.getByRole("button", { name: "「苔」の絞り込みを外す" })).toBeVisible();
  await expect(timeline.locator("li.post")).toHaveCount(1);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  const byName = (await (
    await page.request.get("/api/posts", { params: { tag: "苔" } })
  ).json()) as { posts: { body: string }[] };
  expect(byName.posts.map((p) => p.body)).toEqual([body]);

  // 導線 2 — §8 focus → 投稿一覧へ: the focused stone becomes the filter.
  await yearChart.getByRole("button", { name: "e2e", exact: true }).click();
  await expect(yearChart.getByText("「e2e」の内訳")).toBeVisible();
  await yearChart.getByRole("button", { name: "投稿一覧へ" }).click();
  await expect(page.getByRole("button", { name: "「e2e」の絞り込みを外す" })).toBeVisible();
  await expect(timeline.locator("li.post")).toHaveCount(2);

  // 導線 3 — §6 bridge: both stones as an AND set (?tags=). The button's name
  // orders the pair by tag id (a < b), so match either spelling.
  await graphChart.getByRole("button", { name: /^(e2e × 苔|苔 × e2e) · 1 片$/ }).click();
  await expect(timeline.locator("li.post")).toHaveCount(1);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  const bySet = (await (
    await page.request.get(`/api/posts?tags=${stoneIds.join(",")}`)
  ).json()) as { posts: { body: string }[] };
  expect(bySet.posts.map((p) => p.body)).toEqual([body]);

  await page.locator(".feed-filter").getByRole("button", { name: "解除" }).click();
  await expect(timeline.locator("li.post")).toHaveCount(2);

  // 編集 (ADR-0003 PR): the second 苔片 is rewritten in place — body and
  // stones replaced, re-encrypted at rest — and the counts stay put: an edit
  // is not a new 苔片. (exact: the tag chips' accessible names contain 編集
  // and 削除 as substrings once the new stone exists.)
  await second.getByRole("button", { name: "編集", exact: true }).click();
  await second.getByLabel("本文").fill("編集された苔片");
  await second.getByLabel("タグ（コンマ区切り・任意）").fill("e2e, 編集");
  await second.getByRole("button", { name: "保存" }).click();

  const edited = timeline.locator("li.post", { hasText: "編集された苔片" });
  await expect(edited).toBeVisible();
  await expect(timeline.getByText("絞り込み用の苔片", { exact: true })).toHaveCount(0);
  await expect(edited.locator(".post-tags .tag-chip")).toHaveText(["e2e", "編集"]);
  await expect(timeline.locator("li.post")).toHaveCount(2);
  await expect(total).toHaveText("計 2 片");
  await expect(today).toHaveClass(/\bl2\b/);

  // At rest both 苔片 are still k1. envelopes — the edit re-encrypted, and no
  // plaintext of the new body ever reached D1.
  const reEncrypted = queryRows<{ body: string }>("SELECT body FROM post");
  expect(reEncrypted).toHaveLength(2);
  for (const row of reEncrypted) {
    expect(row.body).toMatch(/^k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  }

  // 削除 (ADR-0003): the native dialog previews what dies, and confirming
  // removes the 苔片 physically — from the list, from the 総草 (on screen and
  // on the wire), and from the rows themselves, links cascaded.
  await edited.getByRole("button", { name: "削除", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm.getByText("編集された苔片")).toBeVisible();
  await confirm.getByRole("button", { name: "削除する" }).click();

  await expect(timeline.locator("li.post")).toHaveCount(1);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await expect(total).toHaveText("計 1 片");
  await expect(today).toHaveClass(/\bl1\b/);
  const afterDelete = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(afterDelete.days.reduce((n, d) => n + d.count, 0)).toBe(1);
  expect(queryRows<{ c: number }>("SELECT COUNT(*) AS c FROM post")[0]?.c).toBe(1);
  // ON DELETE CASCADE took the dead 苔片's links; the survivor keeps its two.
  expect(queryRows<{ c: number }>("SELECT COUNT(*) AS c FROM post_tags")[0]?.c).toBe(2);

  // 期間絞り込み (features.md §3): the presets cut where the server cuts. The
  // feed's `today` is the server's JST day — the 総草's `to` names the same
  // day — and the survivor was stacked today, so 今日 keeps it.
  const feed = page.locator("section.post-feed");
  await feed.getByText("期間で絞る").click();
  await feed.getByRole("button", { name: "今日" }).click();
  const todayKey = afterDelete.to;
  const periodChip = page.getByRole("button", { name: "期間の絞り込みを外す" });
  await expect(periodChip).toHaveText(`${slashed(todayKey)} ×`);
  await expect(timeline.locator("li.post")).toHaveCount(1);
  const byDay = (await (
    await page.request.get("/api/posts", { params: { from: todayKey, to: todayKey } })
  ).json()) as PostsWire;
  expect(byDay.today).toBe(todayKey);
  expect(byDay.posts.map((p) => [p.body, p.day])).toEqual([[body, todayKey]]);

  // Move the survivor back one day AT REST (the API can only stack "now"): the
  // same day window empties while yesterday's holds it — the JST cut of
  // `created_at`, against the real sqlite — and each half stands alone.
  executeSql("UPDATE post SET created_at = created_at - 86400000");
  const yesterday = shiftDay(todayKey, -1);
  const countIn = async (params: Record<string, string>) =>
    ((await (await page.request.get("/api/posts", { params })).json()) as PostsWire).posts.length;
  expect(await countIn({ from: todayKey, to: todayKey })).toBe(0);
  expect(await countIn({ from: yesterday, to: yesterday })).toBe(1);
  expect(await countIn({ to: yesterday })).toBe(1);
  expect(await countIn({ from: todayKey })).toBe(0);
  // Nothing the server would have to guess at: an inverted pair, a non-day.
  const rejected = async (params: Record<string, string>) =>
    (await page.request.get("/api/posts", { params })).status();
  expect(await rejected({ from: todayKey, to: yesterday })).toBe(400);
  expect(await rejected({ from: "2026-02-30" })).toBe(400);

  // The custom range finds it on yesterday …
  await feed.getByLabel("開始日").fill(yesterday);
  await feed.getByLabel("終了日").fill(yesterday);
  await feed.getByRole("button", { name: "絞る" }).click();
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();

  // … and an inverted range never leaves the browser: 開始日 after 終了日 is
  // the field's own rangeOverflow (max = 終了日), the submit is blocked, the
  // chip stays, and no request — hence no error — is made.
  const fromField = feed.getByLabel("開始日");
  await fromField.fill(todayKey);
  await feed.getByRole("button", { name: "絞る" }).click();
  expect(await fromField.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(
    true,
  );
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await expect(feed.locator("[role=alert]")).toHaveCount(0);

  // 今日 now finds nothing — the 苔片 is yesterday's — and the chip's × brings it back.
  await feed.getByRole("button", { name: "今日" }).click();
  await expect(feed.getByText("この絞り込みに合う苔片はありません。")).toBeVisible();
  await periodChip.click();
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
});
