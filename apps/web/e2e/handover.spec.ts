import { expect, test } from "@playwright/test";
import { E2E_INITIAL_REGISTRATION_TOKEN } from "./env";
import { shiftDay, slashed } from "./helpers/day";
import { queryRows } from "./helpers/db";
import { tagChips } from "./helpers/tags";
import { enableVirtualAuthenticator } from "./helpers/webauthn";

// 渡す (ADR-0009, docs/senders.md「リンクで渡す」): a page elsewhere links to
// /積む#post=<JSON>, and the 積む dialog opens with what it hands over — body,
// stones, 向き, day — while NOTHING is posted until 積む is pressed. The
// browser never sends the fragment, so what this checks is the app's half: no
// /api request carries the body before 積む, and exactly one does after. Then
// the grill's rules (2026-11-24): the 書きかけ goes aside and comes back (②),
// a link the API would refuse opens nothing and says why (①), and a link
// opened before the login waits through it — a reload included — and opens
// after it (④).

/** The link a 送り側 builds: encodeURIComponent of a POST /api/posts body. */
const linkTo = (post: unknown) => `/積む#post=${encodeURIComponent(JSON.stringify(post))}`;

const postCount = () => queryRows<{ c: number }>("SELECT COUNT(*) AS c FROM post")[0]?.c ?? 0;

test("a link hands a 苔片 over: the dialog opens filled, and only 積む posts it", async ({ page }) => {
  await enableVirtualAuthenticator(page);

  // Works standalone (fresh DB → new user) and after the other specs (the
  // single-user rule adds this passkey to the existing user).
  await page.goto("/");
  await page.getByText("初回登録（登録トークンが必要）").click();
  await page.getByLabel("表示名").fill("e2e-handover");
  await page.getByLabel("登録トークン").fill(E2E_INITIAL_REGISTRATION_TOKEN);
  await page.getByRole("button", { name: "パスキーを作って登録" }).click();
  const logout = page.getByRole("button", { name: "ログアウト" });
  await expect(logout).toBeVisible();

  const { today } = (await (await page.request.get("/api/posts")).json()) as { today: string };
  const yesterday = shiftDay(today, -1);
  const marker = `渡す-${Date.now()}`;

  // Every /api request that carries the handed body — in its URL or its payload.
  const carried: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/")) return;
    if (decodeURIComponent(request.url()).includes(marker) || (request.postData() ?? "").includes(marker)) {
      carried.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  const dialog = page.getByRole("dialog");
  const body = dialog.getByLabel("いまの苔片");
  const stack = page.getByRole("button", { name: "積む", exact: true }).and(page.locator(".fab"));
  const receipt = page.locator("header.bar").getByRole("status");

  // ② The owner's own 書きかけ, left in the dialog: the link must not eat it.
  await stack.click();
  await body.fill("設計メモ（書きかけ）");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // The note 透き通る means to hand over: title and link, its stones, input, the day it was read.
  const note = {
    body: `[${marker}](https://example.com/news/n.html)`,
    tags: ["透き通る", "os"],
    kind: "input",
    firstDay: yesterday,
  };
  const before = postCount();
  await page.goto(linkTo(note));
  await expect(dialog).toBeVisible();
  // /積む and the fragment leave the address bar: a reload does not open it again.
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(body).toHaveValue(note.body);
  await expect(tagChips(dialog)).toHaveText(["透き通る", "os"]);
  await expect(dialog.getByRole("radio", { name: "インプット", exact: true })).toBeChecked();
  await expect(dialog.getByLabel("いつ", { exact: true })).toHaveValue(yesterday);
  await expect(dialog.getByText("リンクで渡された苔片です。積むを押すまで苔片にはなりません。")).toBeVisible();
  await expect(dialog.getByText("書きかけ 1 件を脇に置いています。これを積むか捨てると戻ります。")).toBeVisible();
  // Opened, and nothing posted, nothing sent.
  expect(postCount()).toBe(before);
  expect(carried).toEqual([]);

  // A 一言, then 積む — the one thing that posts.
  await body.fill(`${note.body}\n\n一言: 層の地図が分かった`);
  await dialog.getByRole("button", { name: "積む", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(carried).toEqual(["POST /api/posts"]);
  expect(postCount()).toBe(before + 1);
  const [row] = queryRows<{ id: string; kind: string; first_day: string; last_day: string; thickness: number | null }>(
    "SELECT id, kind, first_day, last_day, thickness FROM post ORDER BY created_at DESC LIMIT 1",
  );
  expect(row).toMatchObject({ kind: "input", first_day: yesterday, last_day: yesterday, thickness: null });
  const stones = queryRows<{ name: string }>(
    `SELECT t.name FROM tag t JOIN post_tags pt ON pt.tag_id = t.id WHERE pt.post_id = '${row?.id ?? ""}' ORDER BY t.name`,
  );
  expect(stones.map((s) => s.name).sort()).toEqual(["os", "透き通る"].sort());
  // A past day: the receipt offers the narrowing, and the 苔片 is there with the 一言.
  await expect(receipt).toContainText("積みました");
  await receipt.getByRole("button", { name: `${slashed(yesterday)} に絞る` }).click();
  await expect(page.locator("ol.posts").getByText("一言: 層の地図が分かった")).toBeVisible();

  // ② The 書きかけ came back for the next open, with nothing left to say.
  await stack.click();
  await expect(body).toHaveValue("設計メモ（書きかけ）");
  await expect(dialog.locator(".compose-notes")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "捨てる" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // ① A link the API would refuse opens nothing — and says which part.
  await page.goto(linkTo({ ...note, source: "sukitooru" }));
  await expect(page.getByRole("alert")).toHaveText("リンクで渡された苔片を開けませんでした: 知らない項目 source");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/localhost:\d+\/$/);

  // ④ Opened before the login: it waits in the address bar, through a reload, and opens after it.
  await logout.click();
  const later = { body: `あとで読んだ ${marker}`, tags: ["透き通る"], kind: "input" };
  const waiting = page.getByText("ログインすると、リンクで渡された苔片が積むダイアログで開きます。");
  await page.goto(linkTo(later));
  await expect(waiting).toBeVisible();
  await page.reload();
  await expect(waiting).toBeVisible();
  await page.getByRole("button", { name: "パスキーでログイン" }).click();
  await expect(dialog).toBeVisible();
  await expect(body).toHaveValue(later.body);
  await expect(tagChips(dialog)).toHaveText(["透き通る"]);
  // Logout took the 書きかけ with it (a shared machine keeps none), so nothing waits aside.
  await expect(dialog.getByText(/脇に置いています/)).toHaveCount(0);

  // 捨てる: the handed 苔片 goes, unposted.
  await dialog.getByRole("button", { name: "捨てる" }).click();
  await expect(dialog).toBeHidden();
  await expect(receipt).toHaveText("渡された苔片を捨てました");
  expect(postCount()).toBe(before + 1);
  await stack.click();
  await expect(body).toHaveValue("");
  await page.keyboard.press("Escape");
});
