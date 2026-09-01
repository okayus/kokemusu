import { describe, expect, it } from "vitest";
import { normalizeTagName, parseTagNames } from "./tag";

describe("normalizeTagName", () => {
  it("trims, NFKC-folds and lowercases", () => {
    expect(normalizeTagName(" TypeScript ")).toBe("typescript");
    expect(normalizeTagName("typescript")).toBe("typescript");
  });

  it("folds full-width forms via NFKC (ＴＳ -> ts, ① -> 1)", () => {
    expect(normalizeTagName("ＴＳ")).toBe("ts");
    expect(normalizeTagName("①")).toBe("1");
  });

  it("strips ideographic space (U+3000) at the edges, keeps inner spaces", () => {
    expect(normalizeTagName("　苔　")).toBe("苔");
    expect(normalizeTagName("machine learning")).toBe("machine learning");
  });

  it("whitespace-only input normalizes to the empty string", () => {
    expect(normalizeTagName("   ")).toBe("");
    expect(normalizeTagName("　")).toBe("");
  });
});

describe("parseTagNames", () => {
  it("dedupes spellings of one stone, first spelling wins as display name", () => {
    expect(parseTagNames(["TypeScript", "typescript", " typescript "])).toEqual([
      { name: "TypeScript", norm: "typescript" },
    ]);
  });

  it("full-width and half-width spellings land on one stone", () => {
    expect(parseTagNames(["ＴＳ", "ts"])).toEqual([{ name: "ＴＳ", norm: "ts" }]);
  });

  it("keeps request order for distinct norms", () => {
    expect(parseTagNames(["b", "a", "c"]).map((t) => t.norm)).toEqual(["b", "a", "c"]);
  });

  it("keeps an empty norm so the caller can reject it (never a silent drop)", () => {
    expect(parseTagNames(["  ", "苔"])).toEqual([
      { name: "", norm: "" },
      { name: "苔", norm: "苔" },
    ]);
  });

  it("empty input -> empty plan", () => {
    expect(parseTagNames([])).toEqual([]);
  });
});
