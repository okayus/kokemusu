import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, MAX_ASIDE, type Draft } from "./draft";
import { arrivalAt, isCalendarDay, isComposePath, readHandedPost, readHandover } from "./handover";

/** The fragment a 送り側 builds — docs/senders.md「リンクで渡す」, spelled the encodeURIComponent way. */
const fragment = (post: unknown) => `#post=${encodeURIComponent(JSON.stringify(post))}`;

/** A note from 透き通る the way it means to hand one over: title and link, content stones and its own, input, the day read. */
const NOTE = {
  body: "[macOS のカーネルを Linux のモジュールとして動かす xnulinux](https://sukitooru.shiraoka.workers.dev/news/2026-11-23-macos-kernel-as-linux-module.html)",
  tags: ["os", "透き通る"],
  kind: "input",
  firstDay: "2026-11-23",
};

const reason = (post: unknown): string => {
  const read = readHandedPost(JSON.stringify(post));
  return read.ok ? "(opened)" : read.reason;
};

describe("isComposePath — /積む, the 積む dialog's entry", () => {
  it("reads the path raw, as the browser percent-encodes it, and with a trailing slash", () => {
    expect(isComposePath("/積む")).toBe(true);
    expect(isComposePath("/%E7%A9%8D%E3%82%80")).toBe(true);
    expect(isComposePath("/積む/")).toBe(true);
  });

  it("is no other path — nor a malformed escape", () => {
    for (const path of ["/", "/年表", "/積むx", "/x/積む", "/%E7"]) expect(isComposePath(path), path).toBe(false);
  });
});

describe("readHandover — the fragment of a link to /積む", () => {
  it("hands nothing over when the fragment is empty — the dialog opens on the 書きかけ as it is", () => {
    expect(readHandover("")).toBeNull();
    expect(readHandover("#")).toBeNull();
  });

  it("reads the note into a handed 書きかけ: every field the dialog has, the stones as chips", () => {
    expect(readHandover(fragment(NOTE))).toEqual({
      ok: true,
      draft: {
        ...EMPTY_DRAFT,
        body: NOTE.body,
        tags: ["os", "透き通る"],
        kind: "input",
        firstDay: "2026-11-23",
        handed: true,
      } satisfies Draft,
    });
  });

  it("reads a fragment built with URLSearchParams too — spaces as +, a literal + as %2B", () => {
    const post = { body: "C++ と a+b のメモ", tags: ["c++"] };
    const read = readHandover(`#${new URLSearchParams({ post: JSON.stringify(post) }).toString()}`);
    expect(read).toMatchObject({ ok: true, draft: { body: "C++ と a+b のメモ", tags: ["c++"] } });
  });

  it("carries one post and nothing else — another key or a second post is refused, never skipped", () => {
    expect(readHandover(`${fragment(NOTE)}&kind=output`)).toEqual({
      ok: false,
      reason: "# の中の知らない項目 kind",
    });
    expect(readHandover("#utm_source=x")).toEqual({ ok: false, reason: "# の中の知らない項目 utm_source" });
    expect(readHandover(`${fragment(NOTE)}&${fragment(NOTE).slice(1)}`)).toEqual({
      ok: false,
      reason: "# の中に post が 2 つあります",
    });
  });

  it("refuses a post that is not JSON — an unencoded & cuts it short", () => {
    expect(readHandover("#post=")).toEqual({ ok: false, reason: "post が JSON として読めません" });
    expect(readHandover(`#post=${JSON.stringify({ body: "A & B" })}`)).toMatchObject({ ok: false });
  });
});

describe("readHandedPost — the POST /api/posts body, held to the API's rules (2026-11-24 grill ①)", () => {
  it("dedupes the stones by norm, first spelling first, as the route does", () => {
    const read = readHandedPost(JSON.stringify({ body: "苔", tags: ["TypeScript", "typescript", " ＴＳ ", "ts"] }));
    expect(read).toMatchObject({ ok: true, draft: { tags: ["TypeScript", "ＴＳ"] } });
  });

  it("leaves what was not handed as the dialog starts it: 未分類, today, 毎日", () => {
    expect(readHandedPost(JSON.stringify({ body: "苔" }))).toEqual({
      ok: true,
      draft: { ...EMPTY_DRAFT, body: "苔", handed: true },
    });
  });

  it("puts a range and its 厚み in the date fields and the slider", () => {
    const read = readHandedPost(
      JSON.stringify({ body: "本を読んだ", firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: 60 }),
    );
    expect(read).toMatchObject({
      ok: true,
      draft: { firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: 60 },
    });
  });

  it.each([
    ["an array", [NOTE], "post が JSON のオブジェクトではありません"],
    ["a string", "苔", "post が JSON のオブジェクトではありません"],
    ["null", null, "post が JSON のオブジェクトではありません"],
    ["an unknown key", { ...NOTE, source: "sukitooru" }, "知らない項目 source"],
    ["the retired 見出し (ADR-0006)", { ...NOTE, title: "題" }, "知らない項目 title"],
    ["no body", { tags: ["os"] }, "本文（body）がありません"],
    ["a body that is not a string", { body: 1 }, "本文（body）が文字列ではありません"],
    ["an empty body", { body: "" }, "本文（body）が空です"],
    ["a blank body", { body: " \n　" }, "本文（body）が空です"],
    ["a body over 20,000", { body: "苔".repeat(20_001) }, "本文（body）が 20,000 字を超えています"],
    ["tags that are not an array", { body: "苔", tags: "os" }, "石（tags）が配列ではありません"],
    ["tags: null", { body: "苔", tags: null }, "石（tags）が配列ではありません"],
    ["100 tags", { body: "苔", tags: Array.from({ length: 100 }, (_, i) => `t${i}`) }, "石（tags）が 99 個を超えています"],
    ["a tag that is not a string", { body: "苔", tags: [1] }, "石（tags）に文字列でないものがあります"],
    ["a tag over 100", { body: "苔", tags: ["x".repeat(101)] }, "石（tags）に 100 字を超える名前があります"],
    ["an empty tag", { body: "苔", tags: [""] }, "石（tags）に空の名前があります"],
    ["a tag that folds to nothing", { body: "苔", tags: ["　 "] }, "石（tags）に空の名前があります"],
    ["a 向き it does not know", { body: "苔", kind: "read" }, "向き（kind）が input・output・both・null のどれでもありません"],
    ["a firstDay that is no calendar day", { body: "苔", firstDay: "2026-02-30" }, "firstDay が YYYY-MM-DD の暦日ではありません"],
    ["a firstDay in another spelling", { body: "苔", firstDay: "2026/11/23" }, "firstDay が YYYY-MM-DD の暦日ではありません"],
    ["firstDay: null", { body: "苔", firstDay: null }, "firstDay が YYYY-MM-DD の暦日ではありません"],
    ["a lastDay that is no calendar day", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-31" }, "lastDay が YYYY-MM-DD の暦日ではありません"],
    ["a 厚み of 0", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: 0 }, "厚み（thickness）が 1〜100 の整数ではありません"],
    ["a 厚み of 60.5", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: 60.5 }, "厚み（thickness）が 1〜100 の整数ではありません"],
    ["a 厚み as text", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: "60" }, "厚み（thickness）が 1〜100 の整数ではありません"],
    ["lastDay alone", { body: "苔", lastDay: "2026-11-20" }, "lastDay だけでは渡せません（firstDay も入れてください）"],
    ["an inverted pair", { body: "苔", firstDay: "2026-11-20", lastDay: "2026-11-01", thickness: 60 }, "firstDay が lastDay より後です"],
    ["a range without a 厚み", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-20" }, "範囲（firstDay < lastDay）には厚み（thickness）が要ります"],
    ["a range with a null 厚み", { body: "苔", firstDay: "2026-11-01", lastDay: "2026-11-20", thickness: null }, "範囲（firstDay < lastDay）には厚み（thickness）が要ります"],
    ["a single day with a 厚み", { body: "苔", firstDay: "2026-11-20", thickness: 60 }, "1 日だけの苔片に厚み（thickness）は付けられません"],
    ["today with a 厚み", { body: "苔", thickness: 100 }, "1 日だけの苔片に厚み（thickness）は付けられません"],
  ])("refuses %s, and says so", (_label, post, said) => {
    expect(reason(post)).toBe(said);
  });

  it("opens what the API takes at its edges: 20,000 characters, 99 stones of 100, null for 向き and 厚み", () => {
    for (const post of [
      { body: "苔".repeat(20_000) },
      { body: "苔", tags: Array.from({ length: 99 }, (_, i) => `${i}`.padStart(100, "x")) },
      { body: "苔", kind: null, thickness: null },
      { body: "苔", firstDay: "2026-11-20", lastDay: "2026-11-20", thickness: null },
    ]) {
      expect(reason(post)).toBe("(opened)");
    }
  });

  it("leaves the days that need today to the dialog: a day not yet come still opens, and the date field stops 積む", () => {
    expect(reason({ body: "苔", firstDay: "2999-01-01" })).toBe("(opened)");
    expect(reason({ body: "苔", firstDay: "1900-01-01" })).toBe("(opened)");
  });
});

describe("isCalendarDay — the mirror of worker/core/day.ts isDayKey", () => {
  it("takes the days the calendar has and nothing else", () => {
    expect(isCalendarDay("2024-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("0099-01-01")).toBe(true);
    expect(isCalendarDay("2026-1-01")).toBe(false);
  });
});

describe("arrivalAt — what opening a link to /積む does with the 書きかけ", () => {
  const own: Draft = { ...EMPTY_DRAFT, body: "設計メモ" };
  const none = { current: EMPTY_DRAFT, aside: [] };

  it("is nothing on any other path, whatever the fragment says", () => {
    expect(arrivalAt("/", fragment(NOTE), none)).toBeNull();
    expect(arrivalAt("/年表", "", none)).toBeNull();
  });

  it("opens the dialog on the 書きかけ as it is when nothing is handed over", () => {
    expect(arrivalAt("/積む", "", { current: own, aside: [] })).toEqual({ open: true, drafts: null });
  });

  it("opens on the handed 苔片 with the 書きかけ set aside", () => {
    const arrival = arrivalAt("/%E7%A9%8D%E3%82%80", fragment(NOTE), { current: own, aside: [] });
    expect(arrival).toMatchObject({ open: true, drafts: { current: { body: NOTE.body, handed: true }, aside: [own] } });
  });

  it("opens nothing for a link the API would refuse, and says which part", () => {
    expect(arrivalAt("/積む", fragment({ ...NOTE, source: "sukitooru" }), none)).toEqual({
      open: false,
      problem: "リンクで渡された苔片を開けませんでした: 知らない項目 source",
    });
  });

  it(`opens nothing once ${MAX_ASIDE} 書きかけ wait aside — and drops none`, () => {
    const full = Array.from({ length: MAX_ASIDE }, (_, i) => ({ ...own, body: `メモ ${i}` }));
    const arrival = arrivalAt("/積む", fragment(NOTE), { current: own, aside: full });
    expect(arrival).toMatchObject({ open: false });
    expect(arrival?.open === false && arrival.problem).toContain(`脇に置いた書きかけが ${MAX_ASIDE} 件ある`);
  });
});
