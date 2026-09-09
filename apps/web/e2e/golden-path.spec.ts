import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { shiftDay, shortDay, slashed } from "./helpers/day";
import { queryRows } from "./helpers/db";
import { fillTags, tagChips } from "./helpers/tags";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

type HeatmapWire = {
  from: string;
  to: string;
  total: number;
  input: number;
  output: number;
  days: { day: string; count: number; level: number; input: number; output: number }[];
};

type PostsWire = {
  posts: {
    body: string;
    firstDay: string;
    lastDay: string;
    thickness: number | null;
    postedDay: string;
  }[];
  today: string;
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

  // The composer is a dialog (features.md §1): the round 積む fixed to the
  // bottom-right corner opens it (icon-only, so its name is asserted here),
  // the fields live inside, and success closes it (the dialog is unmounted).
  const bar = page.locator("header.bar");
  const stack = page.getByRole("button", { name: "積む", exact: true }).and(page.locator(".fab"));
  const dialog = page.getByRole("dialog");
  const body = `e2e の苔片 ${Date.now()}`;
  await stack.click();
  await dialog.getByLabel("いまの苔片").fill(body);
  await fillTags(dialog, ["e2e", "苔"]);
  await expect(tagChips(dialog)).toHaveText(["e2e", "苔"]);
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();

  const timeline = page.locator("ol.posts");
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await expect(timeline.locator(".post-tags .tag-chip")).toHaveText(["e2e", "苔"]);

  // DoD 4, on screen and on the wire: exactly one step darker, and only today.
  await expect(total).toHaveText("計 1 片");
  await expect(today).toHaveClass(/\bl1\b/);
  const heatmap = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(heatmap.days.at(-1)).toEqual({ day: heatmap.to, count: 1, level: 1, input: 0, output: 0 });
  expect(heatmap.days.reduce((n, d) => n + d.count, 0)).toBe(1);

  // 石の年表 (visualization.md §8) is the other view (features.md §3, 2026-09-07):
  // the bar's 年表 link brings it up in place of the feed — the URL follows —
  // and the two stones appear as one row each. A row's chip makes that stone
  // the axis: its 内訳年表, the stone alone plus stone × 共起タグ.
  const yearChart = page.locator("section.tag-timeline");
  const feedSection = page.locator("section.post-feed");
  const viewLink = (name: string) => page.getByRole("link", { name, exact: true });
  await expect(yearChart).toBeHidden();
  await viewLink("年表").click();
  await expect(page).toHaveURL(/\/%E5%B9%B4%E8%A1%A8$/);
  await expect(viewLink("年表")).toHaveAttribute("aria-current", "page");
  await expect(yearChart).toBeVisible();
  await expect(feedSection).toBeHidden();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await expect(yearChart.locator(".tl-note").first()).toHaveText("1 片 · 1.0日/片");
  await yearChart.getByRole("button", { name: "e2e", exact: true }).click();
  await expect(yearChart.getByText("「e2e」の内訳")).toBeVisible();
  const focusRows = yearChart.locator("li.tl-row");
  await expect(focusRows).toHaveCount(2);
  await expect(focusRows.nth(1).getByRole("button", { name: "苔", exact: true })).toBeVisible();
  await yearChart.getByRole("button", { name: "すべての石へ" }).click();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);

  // 石のつながり (visualization.md §6) is the 操作盤 of both views: two stones on
  // one 苔片 = one bridge, and a stone tap toggles it into the 選んだ石 — here
  // the 年表's axis. A second stone deepens the axis to the pair (the set's own
  // row; no third stone to add a set×stone row), the same tap again lets a
  // stone go, and the bridge is pressed exactly while both its ends are.
  const graphChart = page.locator("section.tag-graph");
  await expect(graphChart.locator(".tg-node")).toHaveCount(2);
  await expect(graphChart.locator(".tg-edge")).toHaveCount(1);
  // Anchored — the bridge's name ("e2e × 苔 · 1 片") contains a stone's too —
  // and open on the count, which grows as the 苔片 below are stacked.
  const mossStone = graphChart.getByRole("button", { name: /^苔 · \d+ 片$/ });
  const e2eStone = graphChart.getByRole("button", { name: /^e2e · \d+ 片$/ });
  // The bridge's name orders the pair by tag id (a < b), so match either spelling.
  const bridge = graphChart.getByRole("button", { name: /^(e2e × 苔|苔 × e2e) · 1 片$/ });
  await expect(mossStone).toHaveAttribute("aria-pressed", "false");
  await mossStone.click();
  await expect(mossStone).toHaveAttribute("aria-pressed", "true");
  await expect(bridge).toHaveAttribute("aria-pressed", "false");
  await expect(yearChart.getByText("「苔」の内訳")).toBeVisible();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await e2eStone.click();
  await expect(bridge).toHaveAttribute("aria-pressed", "true");
  await expect(yearChart.getByText("「苔 × e2e」の内訳")).toBeVisible();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(1);
  await mossStone.click();
  await expect(mossStone).toHaveAttribute("aria-pressed", "false");
  await expect(bridge).toHaveAttribute("aria-pressed", "false");
  await expect(yearChart.getByText("「e2e」の内訳")).toBeVisible();
  await yearChart.getByRole("button", { name: "すべての石へ" }).click();
  await expect(yearChart.locator("li.tl-row")).toHaveCount(2);
  await expect(e2eStone).toHaveAttribute("aria-pressed", "false");

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
    rows: {
      tags: { id: string; name: string }[];
      firstDay: string;
      lastDay: string;
      count: number;
      months: { month: string; count: number }[];
    }[];
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

  // `?focus=` takes the same list since 2026-09-07 (選んだ石, docs/plans/
  // tabs-and-stones.md) — no UI drives it until the tabs land, so prove the
  // set SQL here: both stones as the axis = the one 苔片 carrying both, its
  // chips in request order, and no third stone to add a set×stone row. A
  // malformed list is the parser's 400, same as ?tags=.
  const pairIds = [...stoneIds].reverse();
  const pairFocus = (await (
    await page.request.get(`/api/stats/timeline?focus=${pairIds.join(",")}`)
  ).json()) as TimelineWire;
  expect(pairFocus.rows).toHaveLength(1);
  expect(pairFocus.rows[0]?.count).toBe(1);
  expect(pairFocus.rows[0]?.tags.map((t) => t.id)).toEqual(pairIds);
  expect(pairFocus.rows[0]?.months).toEqual(thisMonth);
  expect((await page.request.get("/api/stats/timeline?focus=a,,b")).status()).toBe(400);

  // At rest it is a `k1.<iv>.<ciphertext>` envelope (ADR-0001), never the text —
  // the DoD 5 check, read from the sqlite itself rather than through the API.
  const stored = queryRows<{ body: string }>("SELECT body FROM post");
  expect(stored).toHaveLength(1);
  expect(stored[0]?.body).toMatch(/^k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/);
  expect(stored[0]?.body).not.toContain("苔片");

  // Persisted — and decrypted on the way back. The view persists too: the
  // reload lands on /年表 (the URL is the view, features.md §3), the back
  // gesture returns to the 投稿一覧 the session started on, and the feed comes
  // back with the 苔片 in it.
  await page.reload();
  await expect(viewLink("年表")).toHaveAttribute("aria-current", "page");
  await expect(yearChart).toBeVisible();
  await expect(feedSection).toBeHidden();
  await page.goBack();
  await expect(viewLink("投稿一覧")).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/$/);
  await expect(feedSection).toBeVisible();
  await expect(yearChart).toBeHidden();
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
  // `n` opens the dialog too (features.md §1) — from the page, not from a field.
  await page.keyboard.press("n");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("いまの苔片").fill(markdownBody);

  // コンポーザのプレビューは苔片の表示と同じ描画器を通る — ここで見えるものが積まれる。
  const composer = dialog.locator("form.composer");
  await composer.locator(".md-preview > summary").click();
  const preview = composer.locator(".md-preview .md");
  await expect(preview.locator("h4")).toHaveText("見出し");
  await expect(preview.locator("li")).toHaveText("箇条書き");

  // The tag field (features.md §2): typing offers the registered stones as a
  // listbox — "e" finds e2e — and Enter takes the highlighted one; a spelling
  // no stone has offers 「…」を新しい石に instead; Escape folds the list and
  // only the list (the dialog stays); Backspace on an empty field takes the
  // last chip back.
  const tagBox = dialog.getByRole("combobox", { name: "タグ（任意）" });
  await tagBox.fill("e");
  await expect(dialog.getByRole("option", { name: "e2e" })).toBeVisible();
  await tagBox.press("Enter");
  await expect(tagChips(dialog)).toHaveText(["e2e"]);
  await expect(tagBox).toHaveValue("");
  await tagBox.fill("新しい石");
  await expect(dialog.getByRole("option", { name: "「新しい石」を新しい石に" })).toBeVisible();
  await tagBox.press("Escape");
  await expect(dialog.getByRole("listbox")).toBeHidden();
  await expect(dialog).toBeVisible();
  await tagBox.fill("");
  await tagBox.press("Backspace");
  await expect(tagChips(dialog)).toHaveCount(0);
  await fillTags(dialog, ["e2e"]);
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
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

  // 導線 2 — §8 focus → 投稿一覧へ: the 選んだ石 are one set for both views
  // (features.md §3), so the 年表 opens already on 「苔」の内訳 from 導線 1; its
  // "e2e" chip makes that stone the axis, and 投稿一覧へ only swaps the view —
  // the feed is filtered by the same stone.
  await viewLink("年表").click();
  await expect(yearChart.getByText("「苔」の内訳")).toBeVisible();
  await yearChart.getByRole("button", { name: "e2e", exact: true }).click();
  await expect(yearChart.getByText("「e2e」の内訳")).toBeVisible();
  await yearChart.getByRole("button", { name: "投稿一覧へ" }).click();
  await expect(viewLink("投稿一覧")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "「e2e」の絞り込みを外す" })).toBeVisible();
  await expect(timeline.locator("li.post")).toHaveCount(2);

  // 導線 3 — §6 bridge: both ends join the 選んだ石 at once — e2e was there, 苔
  // joins — the AND set (?tags=). A stone tap then lets that one end go, and
  // the other stays as the filter.
  await bridge.click();
  await expect(bridge).toHaveAttribute("aria-pressed", "true");
  await expect(timeline.locator("li.post")).toHaveCount(1);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  const bySet = (await (
    await page.request.get(`/api/posts?tags=${stoneIds.join(",")}`)
  ).json()) as { posts: { body: string }[] };
  expect(bySet.posts.map((p) => p.body)).toEqual([body]);
  await e2eStone.click();
  await expect(bridge).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "「e2e」の絞り込みを外す" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "「苔」の絞り込みを外す" })).toBeVisible();
  await expect(timeline.locator("li.post")).toHaveCount(1);

  await page.locator(".feed-filter").getByRole("button", { name: "解除" }).click();
  await expect(timeline.locator("li.post")).toHaveCount(2);
  await expect(mossStone).toHaveAttribute("aria-pressed", "false");

  // 編集 (ADR-0003 PR): the second 苔片 is rewritten in place — body and
  // stones replaced, re-encrypted at rest — and the counts stay put: an edit
  // is not a new 苔片. (exact: the tag chips' accessible names contain 編集
  // and 削除 as substrings once the new stone exists.)
  await second.getByRole("button", { name: "編集", exact: true }).click();
  await second.getByLabel("本文").fill("編集された苔片");
  // The edit form starts from the 苔片's own stones as chips; one more is typed.
  await expect(tagChips(second)).toHaveText(["e2e"]);
  await fillTags(second, ["編集"]);
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
  expect(byDay.posts.map((p) => [p.body, p.firstDay])).toEqual([[body, todayKey]]);

  // Move the survivor back one day through the edit form (plans/day-axis-and-
  // kind.md §A2: PATCH takes the days): its 「日: YYYY/MM/DD」 fold opens the two
  // date fields, both set to yesterday. Its 「日」 is `first_day` / `last_day`
  // (ADR-0005), so the same-day window — the one the feed is narrowed to —
  // lets it go on the spot, while yesterday's holds it: the overlap, against
  // the real sqlite, and each half stands alone.
  const yesterday = shiftDay(todayKey, -1);
  const survivorCard = timeline.locator("li.post").first();
  await survivorCard.getByRole("button", { name: "編集", exact: true }).click();
  await survivorCard.getByText(`日: ${slashed(todayKey)}`).click();
  await survivorCard.getByLabel("いつ", { exact: true }).fill(yesterday);
  await survivorCard.getByLabel("〜いつまで").fill(yesterday);
  await survivorCard.getByRole("button", { name: "保存" }).click();
  await expect(feed.getByText("この絞り込みに合う苔片はありません。")).toBeVisible();
  expect(
    queryRows<{ first_day: string; last_day: string }>("SELECT first_day, last_day FROM post"),
  ).toEqual([{ first_day: yesterday, last_day: yesterday }]);
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

  // The custom range finds it on yesterday — and its card now shows the day
  // and 「M/D に積む」 (it was written today) instead of a time (features.md §1).
  await feed.getByLabel("開始日").fill(yesterday);
  await feed.getByLabel("終了日").fill(yesterday);
  await feed.getByRole("button", { name: "絞る" }).click();
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await expect(survivorCard.locator(".post-days")).toHaveText(slashed(yesterday));
  await expect(survivorCard.locator(".post-posted")).toHaveText(`${shortDay(todayKey)} に積む`);
  await expect(survivorCard.locator(".post-meta")).not.toContainText(":");

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

  // 総草のマスのタップ (visualization.md §1): the fourth 導線 into the feed. A
  // reload redraws the 総草 from the rows: the survivor on yesterday's cell,
  // today's empty. One tab stop: today's cell, ↑ walks a day back and the stop
  // follows, Enter lands the feed on that day — the same 1-day window the 今日
  // preset makes, so the chip reads the day. A click on today's cell finds
  // nothing (the 苔片 is yesterday's), and × brings it back.
  await page.reload();
  const cellOf = (day: string) => page.locator(`rect.heatmap-cell[data-day="${day}"]`);
  await expect(cellOf(yesterday)).toHaveClass(/\bl1\b/);
  await expect(today).toHaveClass(/\bl0\b/);
  await expect(today).toHaveAttribute("tabindex", "0");
  await today.focus();
  await page.keyboard.press("ArrowUp");
  await expect(cellOf(yesterday)).toBeFocused();
  await expect(cellOf(yesterday)).toHaveAttribute("tabindex", "0");
  await expect(today).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Enter");
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();
  await today.click();
  await expect(periodChip).toHaveText(`${slashed(todayKey)} ×`);
  await expect(feed.getByText("この絞り込みに合う苔片はありません。")).toBeVisible();
  await periodChip.click();
  await expect(timeline.getByText(body, { exact: true })).toBeVisible();

  // 積む dialog (features.md §1): closing is saving. Nothing carried over from
  // the last post (the draft was spent); a body typed and dismissed with Esc is
  // there again on the next open.
  await stack.click();
  await expect(tagChips(dialog)).toHaveCount(0);
  await expect(tagBox).toHaveValue("");
  await expect(dialog.getByLabel("いまの苔片")).toHaveValue("");
  await dialog.getByLabel("いまの苔片").fill("今日の苔片");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await stack.click();
  await expect(dialog.getByLabel("いまの苔片")).toHaveValue("今日の苔片");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Posting while the feed is narrowed to yesterday: today's 苔片 falls outside
  // the window, so the feed does not move — the bar says so and the moss
  // darkens; the chip's × then shows it at the head.
  await cellOf(yesterday).click();
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await stack.click();
  await expect(dialog.getByLabel("いまの苔片")).toHaveValue("今日の苔片");
  await fillTags(dialog, ["e2e"]);
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
  const receipt = bar.getByRole("status");
  await expect(receipt).toHaveText("積みました（いまの絞り込みの外）");
  await expect(timeline.locator("li.post")).toHaveCount(1);
  await expect(total).toHaveText("計 2 片");
  await expect(today).toHaveClass(/\bl1\b/);
  await periodChip.click();
  await expect(timeline.locator("li.post")).toHaveCount(2);
  await expect(timeline.locator("li.post").first()).toContainText("今日の苔片");

  // 同じ石に積む (CONTEXT.md): the survivor's stones seed the tag field and the
  // body starts empty; the new 苔片 lands at the head of the feed carrying them.
  const survivor = timeline.locator("li.post").nth(1);
  await expect(survivor.getByText(body, { exact: true })).toBeVisible();
  await survivor.getByRole("button", { name: "同じ石に積む" }).click();
  await expect(tagChips(dialog)).toHaveText(["e2e", "苔"]);
  await expect(dialog.getByLabel("いまの苔片")).toHaveValue("");
  await dialog.getByLabel("いまの苔片").fill("同じ石に積んだ苔片");
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(receipt).toHaveText("積みました");
  const stacked = timeline.locator("li.post").first();
  await expect(stacked).toContainText("同じ石に積んだ苔片");
  await expect(stacked.locator(".post-tags .tag-chip")).toHaveText(["e2e", "苔"]);
  await expect(stacked).toBeInViewport();
  await expect(timeline.locator("li.post")).toHaveCount(3);
  await expect(total).toHaveText("計 3 片");

  // 向き (plans/day-axis-and-kind.md §B): two 苔片 stacked as インプット make
  // today's cell lean 吸う — its readout carries the two sides, the caption
  // the window's ratio (5 苔片 overlap it, 2 face in), the wire both, the
  // card a word, and D1 the column. Then 編集 back to 未分類 clears it (PATCH
  // reads the whole form: an unpicked 向き is null), and the cell follows.
  for (const text of ["読んだ 1", "読んだ 2"]) {
    await stack.click();
    await dialog.getByLabel("いまの苔片").fill(text);
    await dialog.getByLabel("インプット", { exact: true }).check();
    await dialog.getByRole("button", { name: "積む", exact: true }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(today).toHaveClass(/\bin\b/);
  await expect(today).toHaveAttribute(
    "aria-label",
    `${slashed(todayKey)} · 4 件（インプット 2・アウトプット 0）`,
  );
  await expect(total).toHaveText("計 5 片");
  await expect(page.locator(".heatmap-lean")).toHaveText("吸う 40% · 出す 0%");
  const leaning = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(leaning.days.at(-1)).toEqual({ day: todayKey, count: 4, level: 4, input: 2, output: 0 });
  expect([leaning.total, leaning.input, leaning.output]).toEqual([5, 2, 0]);
  const read = timeline.locator("li.post").first();
  await expect(read).toContainText("読んだ 2");
  await expect(read.locator(".post-kind")).toHaveText("インプット");
  expect(
    queryRows<{ kind: string | null }>("SELECT kind FROM post WHERE kind IS NOT NULL"),
  ).toEqual([{ kind: "input" }, { kind: "input" }]);

  await read.getByRole("button", { name: "編集", exact: true }).click();
  await read.getByLabel("未分類", { exact: true }).check();
  await read.getByRole("button", { name: "保存" }).click();
  await expect(read.locator(".post-kind")).toHaveCount(0);
  await expect(today).toHaveAttribute(
    "aria-label",
    `${slashed(todayKey)} · 4 件（インプット 1・アウトプット 0）`,
  );
  await expect(page.locator(".heatmap-lean")).toHaveText("吸う 20% · 出す 0%");
  const stillIn = queryRows<{ c: number }>("SELECT COUNT(*) AS c FROM post WHERE kind = 'input'");
  expect(stillIn[0]?.c).toBe(1);

  // 過去に積む (plans/day-axis-and-kind.md §A2, ADR-0005): 積む日 sits under the
  // stones in the dialog, unfolded; いつ alone = that one past day. The 苔片 is not at the head, so the
  // feed stays put and is never narrowed on its own — the receipt offers the
  // narrowing as a button (features.md §1) — while yesterday's cell darkens by
  // one (the survivor is there already) and the window counts one more. Its
  // card shows the day and 「M/D に積む」, no time.
  await stack.click();
  await dialog.getByLabel("いつ", { exact: true }).fill(yesterday);
  await dialog.getByLabel("いまの苔片").fill("昨日の苔片");
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(receipt).toContainText("積みました");
  const narrowToYesterday = receipt.getByRole("button", { name: `${slashed(yesterday)} に絞る` });
  await expect(narrowToYesterday).toBeVisible();
  await expect(timeline.locator("li.post").first()).toContainText("読んだ 2");
  await expect(cellOf(yesterday)).toHaveClass(/\bl2\b/);
  await expect(total).toHaveText("計 6 片");
  await narrowToYesterday.click();
  await expect(periodChip).toHaveText(`${slashed(yesterday)} ×`);
  await expect(timeline.locator("li.post")).toHaveCount(2);
  const pastCard = timeline.locator("li.post", { hasText: "昨日の苔片" });
  await expect(pastCard).toBeVisible();
  await expect(pastCard.locator(".post-days")).toHaveText(slashed(yesterday));
  await expect(pastCard.locator(".post-posted")).toHaveText(`${shortDay(todayKey)} に積む`);
  await expect(pastCard.locator(".post-meta")).not.toContainText(":");
  const stackedPast = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(stackedPast.days.find((d) => d.day === yesterday)?.count).toBe(2);
  expect(stackedPast.total).toBe(6);
  const yesterdaysPosts = (await (
    await page.request.get("/api/posts", { params: { from: yesterday, to: yesterday } })
  ).json()) as PostsWire;
  expect(yesterdaysPosts.posts.map((p) => [p.body, p.firstDay, p.lastDay, p.postedDay])).toEqual([
    ["昨日の苔片", yesterday, yesterday, todayKey],
    [body, yesterday, yesterday, todayKey],
  ]);
  await periodChip.click();

  // 続く苔片 (CONTEXT.md): いつ = yesterday, 〜いつまで = today. Each of its days
  // is +1 (today's cell is saturated at l4 already — its readout counts) while
  // the window counts it ONCE (計 7 片, not the cells' sum); the 年表 spans its
  // stone from yesterday to today and lists the month(s) it touches; and 今日's
  // window holds it — the overlap, on the wire and on screen. The dialog
  // started clean: the past day was spent with the post, nothing carried over.
  await stack.click();
  await expect(dialog.getByLabel("いつ", { exact: true })).toHaveValue("");
  await dialog.getByLabel("いつ", { exact: true }).fill(yesterday);
  await dialog.getByLabel("〜いつまで").fill(todayKey);
  await dialog.getByLabel("いまの苔片").fill("二日続いた苔片");
  await fillTags(dialog, ["続き"]);
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    receipt.getByRole("button", { name: `${slashed(yesterday)} 〜 ${slashed(todayKey)} に絞る` }),
  ).toBeVisible();
  await expect(cellOf(yesterday)).toHaveClass(/\bl3\b/);
  await expect(today).toHaveAttribute(
    "aria-label",
    `${slashed(todayKey)} · 5 件（インプット 1・アウトプット 0）`,
  );
  await expect(total).toHaveText("計 7 片");
  const spanned = (await (await page.request.get("/api/stats/heatmap")).json()) as HeatmapWire;
  expect(spanned.days.find((d) => d.day === yesterday)?.count).toBe(3);
  expect(spanned.days.at(-1)?.count).toBe(5);
  expect(spanned.total).toBe(7);
  const spanRow = (
    (await (await page.request.get("/api/stats/timeline")).json()) as TimelineWire
  ).rows.find((r) => r.tags.length === 1 && r.tags[0]?.name === "続き");
  expect(spanRow).toBeDefined();
  expect([spanRow?.firstDay, spanRow?.lastDay, spanRow?.count]).toEqual([yesterday, todayKey, 1]);
  expect(spanRow?.months.map((m) => m.month)).toEqual([
    ...new Set([yesterday.slice(0, 7), todayKey.slice(0, 7)]),
  ]);
  expect(spanRow?.months.every((m) => m.count === 1)).toBe(true);
  // The 年表 is the other view (hidden here, still mounted): its row exists.
  await expect(yearChart.locator("li.tl-row", { hasText: "続き" })).toHaveCount(1);
  await today.click();
  await expect(periodChip).toHaveText(`${slashed(todayKey)} ×`);
  const spanCard = timeline.locator("li.post", { hasText: "二日続いた苔片" });
  await expect(spanCard).toBeVisible();
  await expect(spanCard.locator(".post-days")).toHaveText(
    `${slashed(yesterday)} 〜 ${slashed(todayKey)}`,
  );
  await expect(spanCard.locator(".post-posted")).toHaveText(`${shortDay(todayKey)} に積む`);
  const todaysPosts = (await (
    await page.request.get("/api/posts", { params: { from: todayKey, to: todayKey } })
  ).json()) as PostsWire;
  // A range from the composer carries 厚み 100 (毎日) until the slider lands
  // (plans/thickness.md PR 3); a single day carries none (ADR-0007).
  expect(todaysPosts.posts.find((p) => p.body === "二日続いた苔片")).toMatchObject({
    body: "二日続いた苔片",
    firstDay: yesterday,
    lastDay: todayKey,
    thickness: 100,
    postedDay: todayKey,
  });
  expect(yesterdaysPosts.posts.map((p) => p.thickness)).toEqual([null, null]);
  await periodChip.click();

  // An inverted pair never leaves the browser: いつ's max is 〜いつまで, so a
  // later いつ is the field's own rangeOverflow — the submit is blocked, the
  // dialog stays, nothing is stacked (the same guard as 期間で絞る's).
  await stack.click();
  await dialog.getByLabel("〜いつまで").fill(yesterday);
  const firstDayField = dialog.getByLabel("いつ", { exact: true });
  await firstDayField.fill(todayKey);
  await dialog.getByLabel("いまの苔片").fill("逆転");
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  expect(await firstDayField.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(
    true,
  );
  await expect(dialog).toBeVisible();
  await expect(total).toHaveText("計 7 片");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The server's half, for a new 苔片 and an edit alike (same body, same rule):
  // a day that has not come, a day the calendar lacks, an inverted pair and a
  // day below the floor are all 400, and nothing is stacked or moved. In-page
  // fetch: the session cookie and the Origin header ride along as the app's own
  // requests do. (Every one of these reads the body before refusing, so the
  // wrangler dev unread-body trap — e2e/README.md — does not apply.)
  const attempt = (method: "POST" | "PATCH", path: string, payload: Record<string, unknown>) =>
    page.evaluate(
      async (req: { method: string; path: string; payload: Record<string, unknown> }) => {
        const res = await fetch(req.path, {
          method: req.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.payload),
        });
        return res.status;
      },
      { method, path, payload },
    );
  const tomorrow = shiftDay(todayKey, 1);
  expect(await attempt("POST", "/api/posts", { body: "未来", firstDay: tomorrow })).toBe(400);
  expect(
    await attempt("POST", "/api/posts", { body: "未来", firstDay: todayKey, lastDay: tomorrow }),
  ).toBe(400);
  expect(await attempt("POST", "/api/posts", { body: "非日付", firstDay: "2026-02-30" })).toBe(400);
  expect(await attempt("POST", "/api/posts", { body: "非日付", lastDay: "きのう" })).toBe(400);
  expect(
    await attempt("POST", "/api/posts", { body: "逆転", firstDay: todayKey, lastDay: yesterday }),
  ).toBe(400);
  expect(await attempt("POST", "/api/posts", { body: "古すぎ", firstDay: "1900-01-01" })).toBe(400);
  // The 厚み (ADR-0007) through the session, as through a PAT (pat.spec.ts):
  // a single day may not carry one, a range must.
  expect(
    await attempt("POST", "/api/posts", { body: "単日に厚み", firstDay: yesterday, thickness: 60 }),
  ).toBe(400);
  expect(
    await attempt("POST", "/api/posts", { body: "範囲だけ", firstDay: yesterday, lastDay: todayKey }),
  ).toBe(400);
  const spanRowId = queryRows<{ id: string }>(
    `SELECT id FROM post WHERE first_day = '${yesterday}' AND last_day = '${todayKey}'`,
  )[0]?.id;
  expect(spanRowId).toBeTruthy();
  expect(
    await attempt("PATCH", `/api/posts/${spanRowId ?? ""}`, { body: "伸ばす", lastDay: tomorrow }),
  ).toBe(400);
  expect(
    await attempt("PATCH", `/api/posts/${spanRowId ?? ""}`, {
      body: "逆転",
      firstDay: todayKey,
      lastDay: yesterday,
    }),
  ).toBe(400);
  // An edit keeps the 厚み it does not mention: shortening the 続く苔片 to one
  // day without saying `thickness: null` leaves a day with a 厚み (400), and
  // taking the 厚み off the range alone leaves a range without one (400).
  expect(
    await attempt("PATCH", `/api/posts/${spanRowId ?? ""}`, {
      body: "縮める",
      firstDay: todayKey,
      lastDay: todayKey,
    }),
  ).toBe(400);
  expect(
    await attempt("PATCH", `/api/posts/${spanRowId ?? ""}`, { body: "厚みだけ外す", thickness: null }),
  ).toBe(400);
  expect(queryRows<{ c: number }>("SELECT COUNT(*) AS c FROM post")[0]?.c).toBe(7);
  expect(
    queryRows<{ first_day: string; last_day: string; thickness: number | null }>(
      `SELECT first_day, last_day, thickness FROM post WHERE id = '${spanRowId ?? ""}'`,
    ),
  ).toEqual([{ first_day: yesterday, last_day: todayKey, thickness: 100 }]);
});
