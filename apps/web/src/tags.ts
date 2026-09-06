// The tag field's state and the pure rules behind it (features.md §2, 2026-09-06):
// stones already chosen as chips, the text still being typed, and what the
// listbox offers for it. All pure — TagField.tsx is the DOM half.
import type { TagSummary } from "./posts-api";

/**
 * Mirror of worker/core/tag.ts `normalizeTagName` (the SPA and the Worker
 * share no package yet, like kind.ts / days.ts): NFKC + trim + lowercase, so
 * "TypeScript" and " typescript " are one stone here as they are in D1.
 */
export const normalizeTagName = (raw: string): string => raw.normalize("NFKC").trim().toLowerCase();

/** One 苔片 carries at most this many stones (worker/core/tag.ts MAX_TAGS_PER_POST). */
export const MAX_TAGS = 20;

/** Half/full-width commas and 読点 — the old comma field's separators, kept for typing and pasting. */
const SEPARATOR = /[,，、]/;

/** A comma-separated spelling → names, blanks dropped (the old field's submit rule; drafts saved by it still read this way). */
export const splitTagText = (raw: string): string[] =>
  raw
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** What the field holds: the stones chosen (display names, in order) and the text not yet committed. */
export type TagsFields = { tags: string[]; text: string };

export const EMPTY_TAGS: TagsFields = { tags: [], text: "" };

/**
 * Stones added by name: trimmed, deduped by norm against what is already
 * there (first spelling wins, as the server does), capped at MAX_TAGS.
 */
export function addStones(tags: string[], names: string[]): string[] {
  const seen = new Set(tags.map(normalizeTagName));
  const out = [...tags];
  for (const raw of names) {
    const name = raw.trim();
    const norm = normalizeTagName(name);
    if (norm === "" || seen.has(norm) || out.length >= MAX_TAGS) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
}

export const removeStone = (fields: TagsFields, index: number): TagsFields => ({
  ...fields,
  tags: fields.tags.filter((_, i) => i !== index),
});

/**
 * The text as typed → fields: everything before the last separator becomes
 * stones, the remainder stays as text. No separator = only the text moves.
 * (Typing or pasting "a, b, c" thus lands as two chips and the text "c".)
 */
export function absorbSeparators(fields: TagsFields, text: string): TagsFields {
  if (!SEPARATOR.test(text)) return { ...fields, text };
  const parts = text.split(SEPARATOR);
  const rest = parts.pop() ?? "";
  return { tags: addStones(fields.tags, parts), text: rest };
}

/**
 * Commit what is typed as a stone (Enter / Tab / submit) — or, when a
 * suggestion was taken, its registered spelling. Blank text just clears.
 */
export function commitText(fields: TagsFields, spelledAs?: string): TagsFields {
  const name = (spelledAs ?? fields.text).trim();
  return { tags: name === "" ? fields.tags : addStones(fields.tags, [name]), text: "" };
}

/** The stones a write carries: the chips, plus the text still in the field — nothing typed is lost on 積む. */
export const stonesOf = (fields: TagsFields): string[] => commitText(fields).tags;

export type Suggestion = { kind: "stone"; id: string; name: string } | { kind: "new"; name: string };

/**
 * What the listbox offers for the text typed: the registered stones not yet
 * chosen — prefix matches first, then the rest of the substring matches, each
 * in the garden's own order (by norm) — and, when the text spells no
 * registered stone, a last row that makes a new one. Empty text offers every
 * stone left (browsing). Matching is by norm, so width and case never hide a
 * stone. The first row is what Enter takes (TagField highlights it).
 */
export function suggestStones(options: TagSummary[], fields: TagsFields): Suggestion[] {
  const chosen = new Set(fields.tags.map(normalizeTagName));
  const q = normalizeTagName(fields.text);
  const left = options
    .map((o) => ({ ...o, norm: normalizeTagName(o.name) }))
    .filter((o) => !chosen.has(o.norm));
  const prefix = left.filter((o) => q === "" || o.norm.startsWith(q));
  const inner = q === "" ? [] : left.filter((o) => !o.norm.startsWith(q) && o.norm.includes(q));
  const rows: Suggestion[] = [...prefix, ...inner].map((o) => ({
    kind: "stone",
    id: o.id,
    name: o.name,
  }));
  const spelled = q !== "" && options.some((o) => normalizeTagName(o.name) === q);
  if (q !== "" && !spelled && fields.tags.length < MAX_TAGS) {
    rows.push({ kind: "new", name: fields.text.trim() });
  }
  return rows;
}
