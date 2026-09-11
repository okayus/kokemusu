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

// ---------------------------------------------------------------------------
// タグ数の上限 2 つ。どちらも D1 の「1 文あたり bound parameter 100 個」
// (developers.cloudflare.com/d1/platform/limits/ — db.batch() の各文にも同じ上限)
// から導く: タグ数 n に比例して parameter を使う SQL がそれぞれにあり、その最悪の
// 1 文が 100 に収まる n が上限。式の数字は drizzle の toSQL().params.length で
// 実測したもの（2026-09-11）。

/** D1: bound parameters one statement may carry (the same cap for each statement of a batch). */
export const D1_MAX_BOUND_PARAMETERS = 100;

/**
 * One 苔片 carries at most this many tags — createPostSchema's cap, mirrored by
 * the composer's `MAX_TAGS` (src/tags.ts) and published in the sender contract.
 * Derivation: the write's widest statement is routes/posts.ts resolveTagRows'
 * `WHERE user_id = ? AND norm IN (?, …)` — 1 + n — so n ≤ 100 − 1 = 99. The
 * batch after it is one INSERT per new tag and per link, a handful of
 * parameters each; D1 caps parameters per statement, not per batch.
 */
export const MAX_TAGS_PER_POST = D1_MAX_BOUND_PARAMETERS - 1;

/**
 * The `?tags=` / `?focus=` set — posts' AND filter, the 年表's deep-dive row and
 * 選んだ石 (`?tags=<id>,<id>,…`, the wire 規約 stats and posts share) — holds
 * at most this many ids. Its own cap since 2026-09-11: it used to be
 * MAX_TAGS_PER_POST (a set no 苔片 can carry is empty by construction), but the
 * set's SQL binds more than the write's — the 年表's focus batch names the set
 * twice (`tag_id IN (…)` and `NOT IN (…)`: 2n + 2, so n ≤ 49) and posts' page
 * adds the cursor, the period and the limit (n + 11, so n ≤ 89). 20 stays:
 * 選んだ石 grows one stone per tap and a bridge adds two, so nothing comes
 * near it, and the routes' 1400-char caps on the raw query string follow it.
 */
export const MAX_TAGS_PER_SET = 20;

/**
 * The comma-separated id list both wire params share: trimmed, deduped, in
 * request order, capped at MAX_TAGS_PER_SET; null on an empty segment, an
 * overlong id, or fewer than `atLeast` unique ids.
 */
function parseIdList(raw: string, atLeast: number): string[] | null {
  const parts = raw.split(",").map((s) => s.trim());
  if (parts.some((p) => p.length === 0 || p.length > 64)) return null;
  const ids = [...new Set(parts)];
  if (ids.length < atLeast || ids.length > MAX_TAGS_PER_SET) return null;
  return ids;
}

/**
 * `?tags=` parsed into 2..MAX_TAGS_PER_SET unique ids in request order, or
 * null for a shape the routes answer 400 to: an empty segment, an overlong id,
 * or a set that isn't a combination (fewer than 2 after dedupe — one tag is
 * each route's single-tag form's job).
 */
export function parseTagsParam(raw: string): string[] | null {
  return parseIdList(raw, 2);
}

/**
 * The timeline's `?focus=` — 選んだ石 (docs/plans/tabs-and-stones.md): the same
 * list as `?tags=` but from 1 id, since one stone is the 年表's everyday axis
 * and the graph adds stones to it one tap at a time.
 */
export function parseFocusParam(raw: string): string[] | null {
  return parseIdList(raw, 1);
}
