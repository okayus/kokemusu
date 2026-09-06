// 向き on the browser side — the mirror of worker/core/kind.ts (the SPA and the
// Worker are one tsconfig but the SPA must not import Worker modules, so the
// three words are spelled once more here). インプット (読む・学ぶ・消費する),
// アウトプット (作る・書く・仕事), 両方; a 苔片 without one is 未分類 = null.

export const POST_KINDS = ["input", "output", "both"] as const;

export type PostKind = (typeof POST_KINDS)[number];

/** What each 向き is called on screen — the radio, the card's mark. */
export const KIND_LABELS: Record<PostKind, string> = {
  input: "インプット",
  output: "アウトプット",
  both: "両方",
};

/** The radio's choices in order, 未分類 last as the way back to none. */
export const KIND_CHOICES: { value: PostKind | null; label: string }[] = [
  ...POST_KINDS.map((value) => ({ value, label: KIND_LABELS[value] })),
  { value: null, label: "未分類" },
];

const isPostKind = (raw: unknown): raw is PostKind =>
  typeof raw === "string" && (POST_KINDS as readonly string[]).includes(raw);

/**
 * Read a 向き off something untyped — a form's `FormData` value (the 未分類
 * radio's value is ""), a stored draft, an API row — anything not one of the
 * three is 未分類, never an error: a wrong word is no 向き.
 */
export const parseKind = (raw: unknown): PostKind | null => (isPostKind(raw) ? raw : null);
