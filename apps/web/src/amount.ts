// 量 and 厚み as the charts read them, browser side — the read-side mirror of
// worker/core/stacking.ts (the SPA must not import Worker modules). The server
// sums the 量 (ADR-0007: a single day is 1, a 続く苔片 its days × 厚み, clipped
// to the period) and keeps it a fraction; the client only shows it and takes
// the 年表's measured 厚み from it. No clock, no zone.

/**
 * 量 for display: whole once it reaches 1 (438.6 → 439, the ADR's example), one
 * decimal below (a clipped or thin 苔片, 0.5 → 0.5). Rounded here and nowhere
 * earlier — sums are made on the fractions.
 */
export function formatAmount(amount: number): string {
  return amount < 1 ? amount.toFixed(1) : String(Math.round(amount));
}

/**
 * The 厚み as MEASURED over some days — 量 ÷ days, the 年表's 「厚み x%」
 * (CONTEXT.md 厚み): one 続く苔片 gives back what it declared, several 苔片 on
 * a day put it past 1, and it is shown so. 0 days is 0, not a division.
 */
export function measuredThickness(amount: number, days: number): number {
  return days > 0 ? amount / days : 0;
}

/** 「x%」 of a measured 厚み — whole, past 100 as it is. */
export const formatMeasured = (thickness: number) => `${Math.round(thickness * 100)}%`;

/** 「厚み x%」 — the 厚み measured over `days`, as a whole percentage. */
export function formatThickness(amount: number, days: number): string {
  return formatMeasured(measuredThickness(amount, days));
}
