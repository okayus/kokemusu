// Browser side of the stats API. Counts and days only — bodies never ride on
// this endpoint (ADR-0001), so the moss draws even while BODY_KEY is missing.
import { request } from "./api";

/** One cell: the JST day, its 苔片 count, and the server-decided 0..4 shade. */
export type HeatmapDay = { day: string; count: number; level: number };

/** Dense ascending series over the resolved window (default: 53 weeks to today). */
export type Heatmap = { from: string; to: string; days: HeatmapDay[] };

export function getHeatmap(opts: { tag?: string } = {}): Promise<Heatmap> {
  const q = new URLSearchParams();
  if (opts.tag !== undefined) q.set("tag", opts.tag);
  const qs = q.toString();
  return request(`/api/stats/heatmap${qs ? `?${qs}` : ""}`);
}
