// 向き (CONTEXT.md): which way a 苔片 faces — 吸う (input: reading, learning,
// consuming), 出す (output: making, writing, work), or both. Optional: a 苔片
// stacked without one is 未分類 and its `kind` is null. A property of the 苔片
// itself, not a tag — it exists so the 総草 can show a lean (吸ってばかり /
// 出してばかり), which is why the two sides below are what core counts.

export const POST_KINDS = ["input", "output", "both"] as const;

export type PostKind = (typeof POST_KINDS)[number];

/** Counts on the 吸う side of the 総草: `input` and `both`. */
export const isInput = (kind: PostKind | null): boolean => kind === "input" || kind === "both";

/** Counts on the 出す side of the 総草: `output` and `both`. */
export const isOutput = (kind: PostKind | null): boolean => kind === "output" || kind === "both";
