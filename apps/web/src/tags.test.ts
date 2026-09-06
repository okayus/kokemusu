import { describe, expect, it } from "vitest";
import {
  absorbSeparators,
  addStones,
  commitText,
  EMPTY_TAGS,
  MAX_TAGS,
  normalizeTagName,
  removeStone,
  splitTagText,
  stonesOf,
  suggestStones,
} from "./tags";

const stones = [
  { id: "1", name: "typescript" },
  { id: "2", name: "読書" },
  { id: "3", name: "TypeScript 型" },
  { id: "4", name: "e2e" },
];

describe("normalizeTagName — the Worker's rule, mirrored", () => {
  it("folds width, case and edges", () => {
    expect(normalizeTagName(" ＴｙｐｅＳｃｒｉｐｔ ")).toBe("typescript");
    expect(normalizeTagName("読書　")).toBe("読書");
  });
});

describe("splitTagText", () => {
  it("splits on half/full-width commas and 読点, dropping blanks", () => {
    expect(splitTagText("a, b，c、 d ,, ")).toEqual(["a", "b", "c", "d"]);
    expect(splitTagText("")).toEqual([]);
  });
});

describe("addStones", () => {
  it("keeps the first spelling and drops a stone already there by norm", () => {
    expect(addStones(["TypeScript"], ["typescript", " 読書 ", "読書", ""])).toEqual([
      "TypeScript",
      "読書",
    ]);
  });

  it("stops at MAX_TAGS", () => {
    const many = Array.from({ length: MAX_TAGS + 3 }, (_, i) => `t${i}`);
    expect(addStones([], many)).toHaveLength(MAX_TAGS);
  });
});

describe("absorbSeparators — typing or pasting a comma commits what is before it", () => {
  it("leaves text without a separator as text", () => {
    expect(absorbSeparators(EMPTY_TAGS, "typ")).toEqual({ tags: [], text: "typ" });
  });

  it("turns everything before the last separator into chips and keeps the rest", () => {
    expect(absorbSeparators({ tags: ["a"], text: "" }, "b, c、d")).toEqual({
      tags: ["a", "b", "c"],
      text: "d",
    });
    expect(absorbSeparators(EMPTY_TAGS, "b,")).toEqual({ tags: ["b"], text: "" });
    expect(absorbSeparators(EMPTY_TAGS, "、")).toEqual({ tags: [], text: "" });
  });
});

describe("commitText / stonesOf", () => {
  it("commits the text, or the registered spelling a suggestion carries, and clears the text", () => {
    expect(commitText({ tags: ["a"], text: " b " })).toEqual({ tags: ["a", "b"], text: "" });
    expect(commitText({ tags: ["a"], text: "TYPESCRIPT" }, "typescript")).toEqual({
      tags: ["a", "typescript"],
      text: "",
    });
    expect(commitText({ tags: ["a"], text: "  " })).toEqual({ tags: ["a"], text: "" });
  });

  it("stonesOf carries the text still typed — nothing is lost on 積む", () => {
    expect(stonesOf({ tags: ["a"], text: "b" })).toEqual(["a", "b"]);
    expect(stonesOf({ tags: ["a"], text: "" })).toEqual(["a"]);
    expect(stonesOf({ tags: ["a"], text: "A" })).toEqual(["a"]);
  });

  it("removeStone takes one chip out by position", () => {
    expect(removeStone({ tags: ["a", "b", "c"], text: "x" }, 1)).toEqual({
      tags: ["a", "c"],
      text: "x",
    });
  });
});

describe("suggestStones", () => {
  it("offers every stone left when nothing is typed, in the garden's order", () => {
    expect(suggestStones(stones, { tags: ["読書"], text: "" }).map((r) => r.name)).toEqual([
      "typescript",
      "TypeScript 型",
      "e2e",
    ]);
  });

  it("puts prefix matches before substring matches, by norm, and offers a new stone when the text spells none", () => {
    expect(suggestStones(stones, { tags: [], text: "Ｔｙ" })).toEqual([
      { kind: "stone", id: "1", name: "typescript" },
      { kind: "stone", id: "3", name: "TypeScript 型" },
      { kind: "new", name: "Ｔｙ" },
    ]);
    expect(suggestStones(stones, { tags: [], text: "script" }).map((r) => r.name)).toEqual([
      "typescript",
      "TypeScript 型",
      "script",
    ]);
  });

  it("offers no new stone when the text spells a registered one — even one already chosen", () => {
    expect(suggestStones(stones, { tags: [], text: "TYPESCRIPT" })).toEqual([
      { kind: "stone", id: "1", name: "typescript" },
      { kind: "stone", id: "3", name: "TypeScript 型" },
    ]);
    expect(suggestStones(stones, { tags: ["typescript"], text: "typescript" })).toEqual([
      { kind: "stone", id: "3", name: "TypeScript 型" },
    ]);
  });

  it("offers only a new stone for a spelling nothing matches, and nothing at all at the cap", () => {
    expect(suggestStones(stones, { tags: [], text: " 苔 " })).toEqual([{ kind: "new", name: "苔" }]);
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(suggestStones([], { tags: full, text: "苔" })).toEqual([]);
  });
});
