import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposeDialog, DaysDisclosure, DaysField, isComposeShortcut, stoneNames } from "./Compose";

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

describe("stoneNames", () => {
  it("is the stones by name, in the 苔片's order", () => {
    expect(
      stoneNames([
        { id: "a", name: "typescript" },
        { id: "b", name: "読書" },
      ]),
    ).toEqual(["typescript", "読書"]);
    expect(stoneNames([])).toEqual([]);
  });
});

/** The one `<input>` carrying this id — React writes `name` / `value` after the other attributes, so match by parts. */
const inputTag = (html: string, id: string): string =>
  html.match(new RegExp(`<input [^>]*id="${id}"[^>]*>`))?.[0] ?? "";

describe("ComposeDialog", () => {
  // No localStorage in Node: loadDraft reads null, so the fields start from the
  // props alone. Effects (showModal, focus) don't run under
  // renderToStaticMarkup — this is about what the form is seeded with.
  const render = (seedTags: string[] | null, today: string | null = "2026-09-06") =>
    renderToStaticMarkup(
      <ComposeDialog
        seedTags={seedTags}
        tagOptions={[]}
        today={today}
        onCreated={() => {}}
        onClose={() => {}}
        onSessionLost={() => {}}
      />,
    );

  it("seeds the tag field from 同じ石に積む — the stones as chips, no text — and nothing else", () => {
    const html = render(["typescript", "読書"]);
    expect(html.match(/<li class="tag-field-chip">/g)).toHaveLength(2);
    expect(html).toContain("<span>typescript</span>");
    expect(html).toContain("<span>読書</span>");
    expect(html).toContain('aria-label="「typescript」を外す"');
    expect(inputTag(html, "post-tags")).toContain('value=""');
    // The body starts empty — only the stones travel (CONTEXT.md).
    expect(html).toMatch(/<textarea[^>]*id="post-body"[^>]*><\/textarea>/);
  });

  it("starts empty without a seed — a combobox with no chips", () => {
    const html = render(null);
    expect(inputTag(html, "post-tags")).toContain('role="combobox"');
    expect(html).not.toContain("tag-field-chip");
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

  it("shows 積む日 unfolded — two native date fields, empty, both capped at the feed's today and floored 1200 months back", () => {
    const html = render(null);
    // No fold in the composer (2026-09-06): the fields are simply in the form.
    expect(html).not.toContain("compose-days");
    expect(html).toContain("<legend>積む日（任意）</legend>");
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
    // No range yet, so no 厚み (ADR-0007: a single day has none).
    expect(html).not.toContain('type="range"');
  });

  it("orders the fields 本文 → 向き → タグ → 積む日, the days last (2026-09-06)", () => {
    const html = render(null);
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const order = [
      "いまの苔片",
      "向き（任意）",
      "タグ（任意）",
      "積む日（任意）",
      "composer-actions",
    ];
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
  });

  it("carries no ceiling while today is still unknown — the server's check is the only one for that moment", () => {
    const html = render(null, null);
    expect(inputTag(html, "post-first-day")).toContain('name="firstDay"');
    expect(inputTag(html, "post-first-day")).not.toContain('min="');
    expect(html).not.toContain('max="');
  });

  it("is a light-dismissable modal named 積む with 閉じる (not やめる), and no 見出し field (ADR-0006)", () => {
    const html = render(null);
    expect(html).toContain('closedby="any"');
    expect(html).toMatch(/<h2 id="[^"]+">積む<\/h2>/);
    expect(html).not.toContain("見出しを付ける");
    expect(html).not.toContain('name="title"');
    expect(html).toContain(">閉じる</button>");
    expect(html).not.toContain("やめる");
  });
});

describe("DaysField — the 厚み slider, there only while the two fields make a range (ADR-0007)", () => {
  const render = (firstDay: string, lastDay: string, thickness = 100, today: string | null = "2026-09-06") =>
    renderToStaticMarkup(
      <DaysField
        idPrefix="x"
        firstDay={firstDay}
        lastDay={lastDay}
        thickness={thickness}
        today={today}
        hint="ヒント"
        onChange={() => {}}
      />,
    );

  it("is a native range 1..100 in whole steps, at the slider's value, with the 目盛り as its datalist", () => {
    const html = render("2022-04-01", "2024-03-31", 60);
    const slider = inputTag(html, "x-thickness");
    expect(slider).toContain('type="range"');
    expect(slider).toContain('name="thickness"');
    expect(slider).toContain('min="1"');
    expect(slider).toContain('max="100"');
    expect(slider).toContain('step="1"');
    expect(slider).toContain('list="x-thickness-ticks"');
    expect(slider).toContain('value="60"');
    expect(slider).toContain('aria-describedby="x-thickness-note"');
    expect(html).toContain('<label for="x-thickness">厚み</label>');
    const ticks = html.match(/<datalist id="x-thickness-ticks">.*?<\/datalist>/)?.[0] ?? "";
    for (const [value, label] of [
      ["14", "週 1"],
      ["60", "仕事"],
      ["71", "平日"],
      ["100", "毎日"],
    ]) {
      const option = ticks.match(new RegExp(`<option [^>]*value="${value}"[^>]*>`))?.[0] ?? "";
      expect(option, value).toContain(`label="${label}"`);
    }
  });

  it("shows the 換算 in an <output> for the slider — 731 days at 60% are 439", () => {
    const html = render("2022-04-01", "2024-03-31", 60);
    expect(html).toContain(
      '<output id="x-thickness-note" for="x-thickness">60% · 731 日のうち 439 日分</output>',
    );
    expect(render("2026-09-05", "2026-09-06", 100)).toContain(">100% · 2 日のうち 2 日分</output>");
  });

  it("puts the 目盛り's names under the track as buttons that set the value, each placed by its share of the track", () => {
    const html = render("2022-04-01", "2024-03-31", 60);
    expect(html.match(/class="thickness-tick"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="週 1 14%"');
    expect(html).toContain('aria-label="仕事 60%"');
    expect(html).toContain('aria-label="平日 71%"');
    expect(html).toContain('aria-label="毎日 100%"');
    expect(html).toContain('style="--at:0"'.replace("0", String((14 - 1) / 99)));
    expect(html).toContain('style="--at:1"');
    // Never a submit: the tick is a value, not the form's button.
    expect(html.match(/<button type="button" class="thickness-tick"/g)).toHaveLength(4);
  });

  it("shows no slider for a single day, one field, nothing, or an inverted pair — only a range has a 厚み", () => {
    for (const [first, last] of [
      ["2026-09-05", "2026-09-05"],
      ["2026-09-05", ""],
      ["", "2026-09-05"],
      ["", ""],
      ["2026-09-06", "2026-09-05"],
    ]) {
      const html = render(first ?? "", last ?? "", 60);
      expect(html, `${first} / ${last}`).not.toContain('type="range"');
      expect(html).not.toContain("<output");
      expect(html).not.toContain("thickness-tick");
    }
  });

  it("keeps the slider while today is unknown — the range is the fields' own, not the ceiling's", () => {
    expect(inputTag(render("2026-09-01", "2026-09-05", 60, null), "x-thickness")).toContain('type="range"');
  });
});

describe("DaysDisclosure — the edit form's fold, whose summary names the days while folded", () => {
  const render = (firstDay: string, lastDay: string, defaultOpen = false, thickness = 100) =>
    renderToStaticMarkup(
      <DaysDisclosure
        idPrefix="edit-x"
        firstDay={firstDay}
        lastDay={lastDay}
        thickness={thickness}
        today="2026-09-06"
        hint="ヒント"
        defaultOpen={defaultOpen}
        onChange={() => {}}
      />,
    );

  it("reads 日を選ぶ with nothing chosen, the day or the range — with its 厚み — once chosen", () => {
    expect(render("", "")).toContain("<summary>日を選ぶ</summary>");
    expect(render("2026-09-05", "2026-09-05")).toContain("<summary>日: 2026/09/05</summary>");
    expect(render("2026-09-01", "2026-09-05")).toContain(
      "<summary>日: 2026/09/01 〜 2026/09/05 · 厚み 100%</summary>",
    );
    expect(render("2026-09-01", "2026-09-05", false, 60)).toContain(
      "<summary>日: 2026/09/01 〜 2026/09/05 · 厚み 60%</summary>",
    );
    // One field alone is that single day — and a single day has no 厚み to name.
    expect(render("", "2026-09-05", false, 60)).toContain("<summary>日: 2026/09/05</summary>");
  });

  it("hides the group's legend — the summary is the name here, but a reader still gets one", () => {
    expect(render("", "")).toContain('<legend class="visually-hidden">積む日</legend>');
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
