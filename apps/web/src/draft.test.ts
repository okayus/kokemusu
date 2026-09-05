import { describe, expect, it } from "vitest";
import { isEmptyDraft, parseDraft } from "./draft";

describe("parseDraft", () => {
  it("reads a full draft", () => {
    expect(parseDraft(JSON.stringify({ title: "見出し", body: "本文", tags: "a, b" }))).toEqual({
      title: "見出し",
      body: "本文",
      tags: "a, b",
    });
  });

  it("reads a draft saved before the 見出し toggle as 見出しなし", () => {
    expect(parseDraft(JSON.stringify({ body: "本文", tags: "" }))).toEqual({
      title: "",
      body: "本文",
      tags: "",
    });
  });

  it.each(["null", "42", '"str"', "[]", "{}", '{"body":1,"tags":""}', "{not json"])(
    "rejects %s",
    (raw) => {
      expect(parseDraft(raw)).toBeNull();
    },
  );
});

describe("isEmptyDraft", () => {
  it("is empty only when every field is", () => {
    expect(isEmptyDraft({ title: "", body: "", tags: "" })).toBe(true);
    expect(isEmptyDraft({ title: "x", body: "", tags: "" })).toBe(false);
    expect(isEmptyDraft({ title: "", body: "", tags: "a" })).toBe(false);
  });
});
