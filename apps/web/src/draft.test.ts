import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, isEmptyDraft, parseDraft } from "./draft";

describe("parseDraft", () => {
  it("reads a full draft", () => {
    expect(
      parseDraft(
        JSON.stringify({
          body: "本文",
          tags: "a, b",
          kind: "input",
          firstDay: "2026-09-01",
          lastDay: "2026-09-05",
        }),
      ),
    ).toEqual({
      body: "本文",
      tags: "a, b",
      kind: "input",
      firstDay: "2026-09-01",
      lastDay: "2026-09-05",
    });
  });

  it("reads a draft saved before the 向き radio and 日を選ぶ as 未分類・今日", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "" }))).toEqual({
      ...EMPTY_DRAFT,
      body: "本文",
    });
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
    expect(isEmptyDraft({ ...EMPTY_DRAFT, tags: "a" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, kind: "output" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, firstDay: "2026-09-01" })).toBe(false);
    expect(isEmptyDraft({ ...EMPTY_DRAFT, lastDay: "2026-09-05" })).toBe(false);
  });
});
