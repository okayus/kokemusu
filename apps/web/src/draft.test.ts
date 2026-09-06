import { describe, expect, it } from "vitest";
import { isEmptyDraft, parseDraft } from "./draft";

describe("parseDraft", () => {
  it("reads a full draft", () => {
    expect(
      parseDraft(JSON.stringify({ title: "見出し", body: "本文", tags: "a, b", kind: "input" })),
    ).toEqual({
      title: "見出し",
      body: "本文",
      tags: "a, b",
      kind: "input",
    });
  });

  it("reads a draft saved before the 見出し toggle and the 向き radio as 見出しなし・未分類", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "" }))).toEqual({
      title: "",
      body: "本文",
      tags: "",
      kind: null,
    });
  });

  it("reads a 向き it does not know as 未分類 rather than dropping the draft", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: "consume" }))?.kind).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: 3 }))?.kind).toBeNull();
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "", kind: "both" }))?.kind).toBe("both");
  });

  it.each(["null", "42", '"str"', "[]", "{}", '{"body":1,"tags":""}', "{not json"])(
    "rejects %s",
    (raw) => {
      expect(parseDraft(raw)).toBeNull();
    },
  );
});

describe("isEmptyDraft", () => {
  it("is empty only when every field is — a 向き alone is worth resuming", () => {
    expect(isEmptyDraft({ title: "", body: "", tags: "", kind: null })).toBe(true);
    expect(isEmptyDraft({ title: "x", body: "", tags: "", kind: null })).toBe(false);
    expect(isEmptyDraft({ title: "", body: "", tags: "a", kind: null })).toBe(false);
    expect(isEmptyDraft({ title: "", body: "", tags: "", kind: "output" })).toBe(false);
  });
});
