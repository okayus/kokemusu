import { describe, expect, it } from "vitest";
import { formatAmount, formatThickness, measuredThickness } from "./amount";

describe("formatAmount — whole from 1 up, one decimal below", () => {
  it("rounds 量 of 1 or more to a whole number — 731 days at 60% read 439", () => {
    expect(formatAmount(438.6)).toBe("439");
    expect(formatAmount(6)).toBe("6");
    expect(formatAmount(1)).toBe("1");
    expect(formatAmount(2.5)).toBe("3");
  });

  it("keeps one decimal under 1 — a clipped or thin 苔片 is not shown as nothing", () => {
    expect(formatAmount(0.5)).toBe("0.5");
    expect(formatAmount(0.06)).toBe("0.1");
    expect(formatAmount(0.96)).toBe("1.0");
    expect(formatAmount(0)).toBe("0.0");
  });
});

describe("measuredThickness / formatThickness — 量 ÷ days, past 100% as it is", () => {
  it("recovers a 続く苔片's declared 厚み, and passes 1 when a day holds several 苔片", () => {
    expect(measuredThickness(438.6, 731)).toBeCloseTo(0.6, 12);
    expect(measuredThickness(10, 10)).toBe(1);
    expect(measuredThickness(3, 1)).toBe(3);
    expect(measuredThickness(0, 0)).toBe(0);
  });

  it("shows a whole percentage", () => {
    expect(formatThickness(6, 10)).toBe("60%");
    expect(formatThickness(438.6, 731)).toBe("60%");
    expect(formatThickness(1, 1)).toBe("100%");
    expect(formatThickness(3, 1)).toBe("300%");
    expect(formatThickness(0.5, 10)).toBe("5%");
    expect(formatThickness(2, 3)).toBe("67%");
  });
});
