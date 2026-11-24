import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  isEmptyDraft,
  MAX_ASIDE,
  parseAside,
  parseDraft,
  receiveHanded,
  resume,
  spend,
  type Draft,
} from "./draft";

describe("parseDraft", () => {
  it("reads a full draft", () => {
    expect(
      parseDraft(
        JSON.stringify({
          body: "本文",
          tags: ["a", "b"],
          tagText: "c",
          kind: "input",
          firstDay: "2026-09-01",
          lastDay: "2026-09-05",
          thickness: 60,
        }),
      ),
    ).toEqual({
      body: "本文",
      tags: ["a", "b"],
      tagText: "c",
      kind: "input",
      firstDay: "2026-09-01",
      lastDay: "2026-09-05",
      thickness: 60,
      handed: false,
    });
  });

  it("reads `handed` only when it is true — a draft saved before the link (2026-11-24) is the owner's own", () => {
    const handed = (value: unknown) =>
      parseDraft(JSON.stringify({ body: "本文", tags: [], handed: value }))?.handed;
    expect(handed(true)).toBe(true);
    expect(handed(false)).toBe(false);
    expect(handed("true")).toBe(false);
    expect(parseDraft(JSON.stringify({ body: "本文", tags: [] }))?.handed).toBe(false);
  });

  it("reads a draft saved before the 向き radio, 日を選ぶ and the 厚み slider as 未分類・今日・毎日", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "" }))).toEqual({
      ...EMPTY_DRAFT,
      body: "本文",
    });
    expect(EMPTY_DRAFT.thickness).toBe(100);
  });

  it("reads a 厚み that is not a whole 1..100 as 毎日 rather than dropping the draft", () => {
    const thickness = (value: unknown) =>
      parseDraft(JSON.stringify({ body: "本文", tags: "", thickness: value }))?.thickness;
    expect(thickness(60)).toBe(60);
    expect(thickness(1)).toBe(1);
    expect(thickness(0)).toBe(100);
    expect(thickness(101)).toBe(100);
    expect(thickness(59.5)).toBe(100);
    expect(thickness("60")).toBe(100);
    expect(thickness(null)).toBe(100);
  });

  it("reads the old field's comma-separated tags as stones, and the chip field's array as it is", () => {
    expect(parseDraft(JSON.stringify({ body: "x", tags: "a, b、c" }))?.tags).toEqual(["a", "b", "c"]);
    const chips = parseDraft(JSON.stringify({ body: "x", tags: ["a", "b"], tagText: "c" }));
    expect(chips?.tags).toEqual(["a", "b"]);
    expect(chips?.tagText).toBe("c");
    expect(parseDraft(JSON.stringify({ body: "x", tags: [1] }))).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "x", tags: null }))).toBeNull();
  });

  it("folds the 見出し of a draft saved before ADR-0006 into the body's first line rather than dropping it", () => {
    expect(parseDraft(JSON.stringify({ title: "題", body: "本文", tags: "" }))?.body).toBe("題\n\n本文");
    expect(parseDraft(JSON.stringify({ title: "題", body: "", tags: "" }))?.body).toBe("題");
    expect(parseDraft(JSON.stringify({ title: "  ", body: "本文", tags: "" }))?.body).toBe("本文");
    expect(parseDraft(JSON.stringify({ title: 1, body: "本文", tags: "" }))?.body).toBe("本文");
  });

  it("reads a 向き it does not know as 未分類 rather than dropping the draft", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: "consume" }))?.kind).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: 3 }))?.kind).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: "both" }))?.kind).toBe("both");
  });

  it("reads a day that is not a string as not chosen rather than dropping the draft", () => {
    const draft = parseDraft(JSON.stringify({ body: "本文", tags: "", firstDay: 20260901, lastDay: null }));
    expect(draft?.firstDay).toBe("");
    expect(draft?.lastDay).toBe("");
  });

  it.each(["null", "42", '"str"', "[]", "{}", '{"body":1,"tags":""}', "{not json"])(
    "rejects %s",
    (raw) => {
      expect(parseDraft(raw)).toBeNull();
    },
  );
});

describe("isEmptyDraft", () => {
  it("is empty only when every field is — a 向き or a day alone is worth resuming", () => {
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, tags: ["a"] })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, tagText: "a" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, kind: "output" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, firstDay: "2026-09-01" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, lastDay: "2026-09-05" })).toBe(false);
  });

  it("does not count the 厚み — a moved slider with no range to show it is nothing to resume", () => {
    expect(isEmptyDraft({ ...EMPTY_DRAFT, thickness: 60 })).toBe(true);
  });
});

describe("the aside — a 書きかけ a handed 苔片 displaced (ADR-0009, 2026-11-24 grill ②)", () => {
  const own: Draft = { ...EMPTY_DRAFT, body: "設計メモ", tags: ["kokemusu"] };
  const handed: Draft = {
    ...EMPTY_DRAFT,
    body: "[題](https://example.com/n)",
    tags: ["透き通る", "os"],
    kind: "input",
    firstDay: "2026-11-23",
    handed: true,
  };
  const other: Draft = { ...handed, body: "[別の題](https://example.com/m)" };

  it("a handed 苔片 takes an empty dialog and sets nothing aside", () => {
    expect(receiveHanded({ current: EMPTY_DRAFT, aside: [] }, handed)).toEqual({
      current: handed,
      aside: [],
    });
  });

  it("sets the 書きかけ aside, on top, and takes the dialog — nothing is overwritten", () => {
    expect(receiveHanded({ current: own, aside: [] }, handed)).toEqual({
      current: handed,
      aside: [own],
    });
    expect(receiveHanded({ current: handed, aside: [own] }, other)).toEqual({
      current: other,
      aside: [own, handed],
    });
  });

  it("moves nothing when the same 苔片 is handed over itself (the link tapped again)", () => {
    expect(receiveHanded({ current: handed, aside: [own] }, { ...handed })).toEqual({
      current: handed,
      aside: [own],
    });
    // With a 一言 added it is no longer the same: the 一言 goes aside rather than away.
    const withWord = { ...handed, body: `${handed.body}\n\nよかった` };
    expect(receiveHanded({ current: withWord, aside: [] }, handed)).toEqual({
      current: handed,
      aside: [withWord],
    });
  });

  it(`refuses — null, nothing moves — once ${MAX_ASIDE} wait aside`, () => {
    const full = Array.from({ length: MAX_ASIDE }, (_, i) => ({ ...own, body: `メモ ${i}` }));
    expect(receiveHanded({ current: other, aside: full }, handed)).toBeNull();
    expect(receiveHanded({ current: other, aside: full.slice(1) }, handed)?.aside).toHaveLength(MAX_ASIDE);
    // An empty dialog needs no room aside.
    expect(receiveHanded({ current: EMPTY_DRAFT, aside: full }, handed)?.current).toEqual(handed);
  });

  it("spending brings the top of the aside back, or leaves the dialog empty", () => {
    expect(spend([own, handed])).toEqual({ current: handed, aside: [own] });
    expect(spend([own])).toEqual({ current: own, aside: [] });
    expect(spend([])).toEqual({ current: EMPTY_DRAFT, aside: [] });
  });

  it("opening on a 書きかけ emptied by hand brings the top back; anything else opens as left", () => {
    expect(resume({ current: EMPTY_DRAFT, aside: [own] })).toEqual({ current: own, aside: [] });
    expect(resume({ current: handed, aside: [own] })).toEqual({ current: handed, aside: [own] });
    expect(resume({ current: EMPTY_DRAFT, aside: [] })).toEqual({ current: EMPTY_DRAFT, aside: [] });
  });

  it("reads the stored aside entry by entry, passing over what is not a draft or holds nothing", () => {
    expect(parseAside(JSON.stringify([own, handed]))).toEqual([own, handed]);
    expect(parseAside(JSON.stringify([own, { body: 1 }, EMPTY_DRAFT, null, handed]))).toEqual([own, handed]);
    expect(parseAside(JSON.stringify(own))).toEqual([]);
    expect(parseAside("{not json")).toEqual([]);
  });
});
