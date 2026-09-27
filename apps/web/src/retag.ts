// 付け替え (features.md §2, CONTEXT.md): the words of the form, the confirm and
// the receipt — pure, so the sentences are unit-tested. App.tsx is the DOM
// half (RetagDisclosure); posts-api.ts carries the wire.
import type { RetagResult, TagSummary } from "./posts-api";

/** What one 付け替え does: stones to put on (by name) and stones to take off (the filter's own). */
export type RetagChange = { add: string[]; remove: TagSummary[] };

/** Nothing to do — the form refuses to go on to the confirm with this. */
export const isEmptyChange = (change: RetagChange): boolean =>
  change.add.length === 0 && change.remove.length === 0;

const quoted = (names: readonly string[]): string => names.map((n) => `「${n}」`).join("と");

/**
 * The confirm's sentence: the filter as the feed's live region words it, the
 * number of 苔片 it holds (「苔片すべて」 while the count is still unknown), and
 * the change — 「…に「a」を足し、「b」を外します。」, either half alone when the
 * other is empty.
 */
export function retagSentence(
  narrowedBy: readonly string[],
  count: number | null,
  change: RetagChange,
): string {
  const scope = `${narrowedBy.join("と")}で絞った${count === null ? "苔片すべて" : ` ${count} 片`}`;
  const adds = quoted(change.add);
  const removes = quoted(change.remove.map((t) => t.name));
  if (change.add.length > 0 && change.remove.length > 0) {
    return `${scope}に${adds}を足し、${removes}を外します。`;
  }
  if (change.add.length > 0) return `${scope}に${adds}を足します。`;
  return `${scope}から${removes}を外します。`;
}

/**
 * The receipt after a 付け替え, for the bar: how many 苔片 the filter held, and
 * — when some already wore the stones asked for — how many stayed as they were.
 */
export function retagReceipt(result: RetagResult): string {
  if (result.matched === 0) return "付け替える苔片はありませんでした";
  const same = result.matched - result.changed;
  return same > 0
    ? `${result.matched} 片を付け替えました（${same} 片はもう同じ石でした）`
    : `${result.matched} 片を付け替えました`;
}
