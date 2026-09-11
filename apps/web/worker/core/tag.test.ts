import { describe, expect, it } from "vitest";
import {
  D1_MAX_BOUND_PARAMETERS,
  MAX_TAGS_PER_POST,
  MAX_TAGS_PER_SET,
  normalizeTagName,
  parseFocusParam,
  parseTagNames,
  parseTagsParam,
} from "./tag";

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

// Moved here from routes/stats.test.ts when posts' ?tags= filter started
// sharing the parser (2026-09-03) — the wire 規約 is core, not one route's.
describe("parseTagsParam", () => {
  it("keeps request order and trims around commas", () => {
    expect(parseTagsParam("b,a")).toEqual(["b", "a"]);
    expect(parseTagsParam(" b , a ")).toEqual(["b", "a"]);
  });

  it("needs a combination: fewer than 2 unique ids is not this form", () => {
    expect(parseTagsParam("a")).toBeNull();
    expect(parseTagsParam("a,a")).toBeNull();
    expect(parseTagsParam("a,a,b")).toEqual(["a", "b"]);
  });

  it("rejects empty segments and overlong ids", () => {
    expect(parseTagsParam("a,,b")).toBeNull();
    expect(parseTagsParam("a,b,")).toBeNull();
    expect(parseTagsParam(`a,${"x".repeat(65)}`)).toBeNull();
  });

  it("caps the set at MAX_TAGS_PER_SET (the set's own cap, below what a 苔片 can carry)", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`).join(",");
    expect(parseTagsParam(ids(MAX_TAGS_PER_SET))).toHaveLength(MAX_TAGS_PER_SET);
    expect(parseTagsParam(ids(MAX_TAGS_PER_SET + 1))).toBeNull();
  });
});

// The two caps are derived from D1's bound-parameter limit (tag.ts): these pin
// the arithmetic to the SQL that binds the tag list, so raising either cap
// re-runs the derivation instead of finding out in production.
describe("the caps against D1's bound parameters per statement", () => {
  it("MAX_TAGS_PER_POST fills resolveTagRows' `user_id = ? AND norm IN (…)` exactly", () => {
    expect(1 + MAX_TAGS_PER_POST).toBe(D1_MAX_BOUND_PARAMETERS);
    expect(MAX_TAGS_PER_POST).toBe(99);
  });

  it("MAX_TAGS_PER_SET fits the 年表's focus batch (2n + 2) and posts' page (n + 11)", () => {
    expect(2 * MAX_TAGS_PER_SET + 2).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    expect(MAX_TAGS_PER_SET + 11).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMETERS);
    expect(MAX_TAGS_PER_SET).toBeLessThanOrEqual(MAX_TAGS_PER_POST);
  });
});

describe("parseFocusParam — the timeline's 選んだ石, the same list from 1 id", () => {
  it("takes one stone (the everyday axis) or a list in request order", () => {
    expect(parseFocusParam("a")).toEqual(["a"]);
    expect(parseFocusParam("b,a")).toEqual(["b", "a"]);
    expect(parseFocusParam(" b , a ")).toEqual(["b", "a"]);
    expect(parseFocusParam("a,a,b")).toEqual(["a", "b"]);
  });

  it("rejects the same shapes as ?tags= — empty segments, overlong ids, more than a set may hold", () => {
    expect(parseFocusParam("")).toBeNull();
    expect(parseFocusParam("a,,b")).toBeNull();
    expect(parseFocusParam("a,b,")).toBeNull();
    expect(parseFocusParam("x".repeat(65))).toBeNull();
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`).join(",");
    expect(parseFocusParam(ids(MAX_TAGS_PER_SET))).toHaveLength(MAX_TAGS_PER_SET);
    expect(parseFocusParam(ids(MAX_TAGS_PER_SET + 1))).toBeNull();
  });
});
