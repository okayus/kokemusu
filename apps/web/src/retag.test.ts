import { describe, expect, it } from "vitest";
import { isEmptyChange, retagReceipt, retagSentence } from "./retag";

const ts = { id: "t1", name: "TS" };
const reading = { id: "t2", name: "読書" };

describe("retagSentence — the confirm names the filter, the count and the change", () => {
  it("both halves: 「…に「a」を足し、「b」を外します。」", () => {
    expect(retagSentence(["「TS」"], 37, { add: ["typescript"], remove: [ts] })).toBe(
      "「TS」で絞った 37 片に「typescript」を足し、「TS」を外します。",
    );
  });

  it("adding alone, taking off alone", () => {
    expect(retagSentence(["「案件A」"], 3, { add: ["仕事"], remove: [] })).toBe(
      "「案件A」で絞った 3 片に「仕事」を足します。",
    );
    expect(retagSentence(["「案件A」", "「読書」"], 2, { add: [], remove: [reading] })).toBe(
      "「案件A」と「読書」で絞った 2 片から「読書」を外します。",
    );
  });

  it("several stones on a side are joined with と; a period in the filter reads as the live region words it", () => {
    expect(
      retagSentence(["「TS」", "2026年9月"], 5, { add: ["typescript", "旧案件"], remove: [ts] }),
    ).toBe("「TS」と2026年9月で絞った 5 片に「typescript」と「旧案件」を足し、「TS」を外します。");
  });

  it("an unknown count (still loading, or failed) reads as 苔片すべて", () => {
    expect(retagSentence(["「TS」"], null, { add: ["typescript"], remove: [] })).toBe(
      "「TS」で絞った苔片すべてに「typescript」を足します。",
    );
  });
});

describe("retagReceipt", () => {
  it("counts the 苔片 of the filter, and how many already wore the stones", () => {
    expect(retagReceipt({ matched: 37, changed: 37 })).toBe("37 片を付け替えました");
    expect(retagReceipt({ matched: 37, changed: 30 })).toBe(
      "37 片を付け替えました（7 片はもう同じ石でした）",
    );
    expect(retagReceipt({ matched: 0, changed: 0 })).toBe("付け替える苔片はありませんでした");
  });
});

describe("isEmptyChange", () => {
  it("is true only with nothing to put on and nothing to take off", () => {
    expect(isEmptyChange({ add: [], remove: [] })).toBe(true);
    expect(isEmptyChange({ add: ["x"], remove: [] })).toBe(false);
    expect(isEmptyChange({ add: [], remove: [ts] })).toBe(false);
  });
});
