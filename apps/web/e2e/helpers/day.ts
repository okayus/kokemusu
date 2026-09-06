// Day-key arithmetic for the specs — civil math on the UTC carrier, the app's
// own trick (worker/core/day.ts, src/period.ts): a `YYYY-MM-DD` key never
// meets a zone here, so "yesterday" is yesterday whatever the runner's clock.

/** A `YYYY-MM-DD` key moved by whole days. */
export const shiftDay = (day: string, days: number): string =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + days))
    .toISOString()
    .slice(0, 10);

/** `YYYY-MM-DD` → `YYYY/MM/DD`, the spelling the cards and chips use. */
export const slashed = (day: string): string => day.replaceAll("-", "/");

/** `YYYY-MM-DD` → `M/D`, the card's 「M/D に積む」. */
export const shortDay = (day: string): string => `${+day.slice(5, 7)}/${+day.slice(8, 10)}`;
