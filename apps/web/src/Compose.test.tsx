import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposeDialog, DaysDisclosure, isComposeShortcut, tagsField } from "./Compose";

describe("isComposeShortcut — `n` opens the dialog only when the key would otherwise do nothing", () => {
  const plain = {
    key: "n",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    inEditable: false,
    dialogOpen: false,
  };

  it("fires on a plain n from the page", () => {
    expect(isComposeShortcut(plain)).toBe(true);
  });

  it.each([
    ["another key", { ...plain, key: "m" }],
    ["shift-n (a capital N)", { ...plain, key: "N" }],
    ["⌘n", { ...plain, metaKey: true }],
    ["ctrl+n", { ...plain, ctrlKey: true }],
    ["alt+n", { ...plain, altKey: true }],
    ["mid-IME composition", { ...plain, isComposing: true }],
    ["typing in a field", { ...plain, inEditable: true }],
    ["a dialog already open", { ...plain, dialogOpen: true }],
  ])("stays quiet for %s", (_label, key) => {
    expect(isComposeShortcut(key)).toBe(false);
  });
});

describe("tagsField", () => {
  it("spells the stones the way the edit form does", () => {
    expect(
      tagsField([
        { id: "a", name: "typescript" },
        { id: "b", name: "読書" },
      ]),
    ).toBe("typescript, 読書");
    expect(tagsField([])).toBe("");
  });
});

/** The one `<input>` carrying this id — React writes `name` / `value` after the other attributes, so match by parts. */
const inputTag = (html: string, id: string): string =>
  html.match(new RegExp(`<input [^>]*id="${id}"[^>]*>`))?.[0] ?? "";

describe("ComposeDialog", () => {
  // No localStorage in Node: loadDraft reads null, so the fields start from the
  // props alone. Effects (showModal, focus) don't run under
  // renderToStaticMarkup — this is about what the form is seeded with.
  const render = (seedTags: string | null, today: string | null = "2026-09-06") =>
    renderToStaticMarkup(
      <ComposeDialog
        seedTags={seedTags}
        today={today}
        onCreated={() => {}}
        onClose={() => {}}
        onSessionLost={() => {}}
      />,
    );

  it("seeds the tag field from 同じ石に積む and nothing else", () => {
    const html = render("typescript, 読書");
    expect(html).toContain('value="typescript, 読書"');
    // The body starts empty — only the stones travel (CONTEXT.md).
    expect(html).toMatch(/<textarea[^>]*id="post-body"[^>]*><\/textarea>/);
  });

  it("starts empty without a seed", () => {
    const html = render(null);
    expect(html).toContain('id="post-tags"');
    expect(html).not.toContain('value="typescript');
  });

  it("offers the 向き as native radios — the three words and 未分類, which is checked until a draft says otherwise", () => {
    const html = render(null);
    expect(html).toContain("<legend>向き（任意）</legend>");
    expect(html.match(/type="radio" name="kind"/g)).toHaveLength(4);
    // React serialises `checked` before `value`; exactly one radio is checked, the 未分類 one.
    expect(html.match(/name="kind" checked=""/g)).toHaveLength(1);
    expect(html).toContain('<input type="radio" name="kind" checked="" value=""/>未分類');
    for (const label of ["インプット", "アウトプット", "両方", "未分類"]) expect(html).toContain(label);
  });

  it("folds 日を選ぶ away — two native date fields, empty, both capped at the feed's today and floored 1200 months back", () => {
    const html = render(null);
    expect(html).toContain('<details class="compose-days"><summary>日を選ぶ</summary>');
    expect(html).not.toMatch(/<details class="compose-days" open/);
    expect(html).toContain("<legend class=\"visually-hidden\">積む日</legend>");
    // Neither field has a value; each names the other's bound through min/max.
    for (const [id, name] of [
      ["post-first-day", "firstDay"],
      ["post-last-day", "lastDay"],
    ] as const) {
      const tag = inputTag(html, id);
      expect(tag).toContain('type="date"');
      expect(tag).toContain(`name="${name}"`);
      expect(tag).toContain('min="1926-10-01"');
      expect(tag).toContain('max="2026-09-06"');
      expect(tag).toContain('aria-describedby="post-days-hint"');
      expect(tag).toContain('value=""');
    }
    expect(html).toContain('<label for="post-first-day">いつ</label>');
    expect(html).toContain('<label for="post-last-day">〜いつまで</label>');
    expect(html).toContain("空のままなら今日に。");
  });

  it("carries no ceiling while today is still unknown — the server's check is the only one for that moment", () => {
    const html = render(null, null);
    expect(inputTag(html, "post-first-day")).toContain('name="firstDay"');
    expect(inputTag(html, "post-first-day")).not.toContain('min="');
    expect(html).not.toContain('max="');
  });

  it("is a light-dismissable modal named 積む, with the 見出し folded and 閉じる (not やめる)", () => {
    const html = render(null);
    expect(html).toContain('closedby="any"');
    expect(html).toMatch(/<h2 id="[^"]+">積む<\/h2>/);
    expect(html).toContain("見出しを付ける");
    expect(html).not.toMatch(/<details class="compose-title" open/);
    expect(html).toContain(">閉じる</button>");
    expect(html).not.toContain("やめる");
  });
});

describe("DaysDisclosure — the fold's summary names the days while folded", () => {
  const render = (firstDay: string, lastDay: string, defaultOpen = false) =>
    renderToStaticMarkup(
      <DaysDisclosure
        idPrefix="edit-x"
        firstDay={firstDay}
        lastDay={lastDay}
        today="2026-09-06"
        hint="ヒント"
        defaultOpen={defaultOpen}
        onChange={() => {}}
      />,
    );

  it("reads 日を選ぶ with nothing chosen, the day or the range once chosen", () => {
    expect(render("", "")).toContain("<summary>日を選ぶ</summary>");
    expect(render("2026-09-05", "2026-09-05")).toContain("<summary>日: 2026/09/05</summary>");
    expect(render("2026-09-01", "2026-09-05")).toContain(
      "<summary>日: 2026/09/01 〜 2026/09/05</summary>",
    );
    // One field alone is that single day.
    expect(render("", "2026-09-05")).toContain("<summary>日: 2026/09/05</summary>");
  });

  it("reads 日を選ぶ while open, whatever is chosen — the fields are in view", () => {
    const html = render("2026-09-01", "2026-09-05", true);
    expect(html).toContain('<details class="compose-days" open=""><summary>日を選ぶ</summary>');
  });

  it("bounds each field by the other: いつ's max is 〜いつまで, 〜いつまで's min is いつ", () => {
    const html = render("2026-09-01", "2026-09-05");
    const first = inputTag(html, "edit-x-first-day");
    expect(first).toContain('min="1926-10-01"');
    expect(first).toContain('max="2026-09-05"');
    expect(first).toContain('value="2026-09-01"');
    const last = inputTag(html, "edit-x-last-day");
    expect(last).toContain('min="2026-09-01"');
    expect(last).toContain('max="2026-09-06"');
    expect(last).toContain('value="2026-09-05"');
  });
});
