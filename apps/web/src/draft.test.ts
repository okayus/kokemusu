import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, isEmptyDraft, parseDraft } from "./draft";

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
    });
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
