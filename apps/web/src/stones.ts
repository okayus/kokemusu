import type { TagSummary } from "./posts-api";

// 選んだ石 (features.md §3, 2026-09-07): the one selection both views read — the
// 投稿一覧's AND filter and the 年表's axis. The graph's stones and bridges
// toggle it (a tap adds, the same tap again takes away); a chip on a 苔片 or a
// 年表 row replaces it with that one stone (a "show me this" 導線, not a
// toggle). Pure functions over the array; the state lives in App.tsx.

const has = (stones: readonly TagSummary[], t: TagSummary) => stones.some((s) => s.id === t.id);

/** A stone in, or the same stone out; the rest keep their order. */
export function toggleStone(stones: readonly TagSummary[], t: TagSummary): TagSummary[] {
  return has(stones, t) ? stones.filter((s) => s.id !== t.id) : [...stones, t];
}

/**
 * A bridge toggles its two ends as one: both in → both out; otherwise the
 * missing end(s) join, in the bridge's own order, after what was there.
 */
export function togglePair(
  stones: readonly TagSummary[],
  a: TagSummary,
  b: TagSummary,
): TagSummary[] {
  if (has(stones, a) && has(stones, b)) {
    return stones.filter((s) => s.id !== a.id && s.id !== b.id);
  }
  const added = [a, b].filter((t) => !has(stones, t));
  return [...stones, ...added];
}
