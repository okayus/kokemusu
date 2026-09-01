// Tag normalization (docs/data-model.md `tag.norm`): different spellings of
// the same tag must land on one stone. NFKC folds width and compatibility
// forms (ＴＳ -> TS, ① -> 1), trim strips edges (U+3000 included), lowercase
// folds case — `COLLATE NOCASE` would only handle ASCII. The display name
// keeps the spelling the user typed; only the norm is folded. Pure functions;
// the (user_id, norm) UNIQUE index enforces the invariant in D1.

export type TagInput = {
  /** Display form — the spelling that creates the tag keeps it ("TypeScript"). */
  name: string;
  /** Normalization key. "" when the raw input had no substance — callers reject that. */
  norm: string;
};

export function normalizeTagName(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/**
 * Fold raw tag names into unique TagInputs: dedupe by norm, keep request
 * order, first spelling wins as the display name. Inputs that normalize to ""
 * are kept (as norm "") so the route can answer validation_error instead of
 * silently dropping what the user typed.
 */
export function parseTagNames(raws: string[]): TagInput[] {
  const seen = new Set<string>();
  const out: TagInput[] = [];
  for (const raw of raws) {
    const norm = normalizeTagName(raw);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ name: raw.trim(), norm });
  }
  return out;
}
