// localStorage 退避 (plans PR4): a failed submit must never eat the entry — and
// since the composer became a dialog (features.md §1, 2026-09-05) neither may
// closing it: Esc, the backdrop, a back gesture and 閉じる all leave the draft
// here, so the next open resumes it. Closing is saving, not discarding. Success
// clears it whole: no stones — and no 向き — carry over to the next 苔片 by
// themselves (同じ石に積む is the one explicit way they do).
// The draft is plaintext on the user's own device — same trust boundary as the
// textarea itself; it is cleared on logout so a shared machine keeps nothing.
// Storage can be unavailable (private mode, blocked site data), so every access
// is wrapped and the composer works without it.
//
// The 書きかけ (CONTEXT.md) is one, but a 苔片 handed over by a link (渡す,
// ADR-0009) must not overwrite it: the 書きかけ goes ASIDE — a stack under the
// dialog, top last — the handed one takes the dialog, and the top comes back
// when that one is 積んだ or 捨てた (2026-11-24 grill ②). The moves are pure
// (receiveHanded / spend / resume); the aside is stored next to the draft and
// cleared with it.

import { EVERY_DAY } from "./days";
import { parseKind, type PostKind } from "./kind";
import { splitTagText } from "./tags";

const KEY = "kokemusu.draft.v1";
const ASIDE_KEY = "kokemusu.draft.aside.v1";

/**
 * Everything the dialog holds. `firstDay` / `lastDay` are the two date fields
 * as typed (`YYYY-MM-DD`, "" = not chosen = today) — the days 退避 like the
 * body, so a 苔片 half-written for last Tuesday is still last Tuesday's when
 * the dialog comes back. `thickness` is the 厚み slider's position (a whole
 * 1..100, ADR-0007), kept even while a single day hides the slider.
 */
export type Draft = {
  body: string;
  /** The stones chosen (chips, by name) and the text still typed in the tag field (tags.ts TagsFields, flattened). */
  tags: string[];
  tagText: string;
  kind: PostKind | null;
  firstDay: string;
  lastDay: string;
  thickness: number;
  /**
   * Handed over by a link (渡す, ADR-0009): the dialog says so and offers 捨てる.
   * Edits keep it handed — it is the same 苔片 with the owner's 一言 — and only
   * spending it (積む, 捨てる) ends it. A draft saved before 2026-11-24 is not.
   */
  handed: boolean;
};

/** A draft with nothing in it — what a fresh dialog starts from and what success leaves. */
export const EMPTY_DRAFT: Draft = {
  body: "",
  tags: [],
  tagText: "",
  kind: null,
  firstDay: "",
  lastDay: "",
  thickness: EVERY_DAY,
  handed: false,
};

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/** A stored 厚み is a whole 1..100; anything else — or none, from a draft saved before the slider — is 毎日. */
const thicknessOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100 ? value : fallback;

/**
 * The stones as stored: an array of names since the chip field (2026-09-06),
 * the one comma-separated string of the field before it — read with the same
 * splitting that field applied on submit. Anything else is not a draft.
 */
const parseStones = (value: unknown): string[] | null =>
  typeof value === "string"
    ? splitTagText(value)
    : Array.isArray(value) && value.every((v): v is string => typeof v === "string")
      ? value
      : null;

/**
 * The stored JSON → a Draft, or null for anything that is not one. `kind`
 * joined the shape with the 向き radio and the days with 日を選ぶ (2026-09-06),
 * `tagText` with the chip field the same day; a draft saved before lacks the
 * field and reads as 未分類 / 今日 / nothing typed, and `thickness` with the
 * slider (2026-09-12), read as 毎日 when absent. A `title` — the 見出し the
 * shape carried from 2026-09-05 until ADR-0006 retired it — is not thrown
 * away: whatever was typed there becomes the body's first line, so a
 * half-written 苔片 loses no words to the change.
 */
export function parseDraft(raw: string): Draft | null {
  try {
    return draftOf(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** One stored draft, already out of JSON — the draft's own key and each entry of the aside. */
function draftOf(parsed: unknown): Draft | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { title, body, tags, tagText, kind, firstDay, lastDay, thickness, handed } = parsed as Record<
    string,
    unknown
  >;
  if (typeof body !== "string") return null;
  const stones = parseStones(tags);
  if (stones === null) return null;
  const heading = stringOr(title, "").trim();
  return {
    body: heading === "" ? body : body === "" ? heading : `${heading}\n\n${body}`,
    tags: stones,
    tagText: stringOr(tagText, ""),
    kind: parseKind(kind),
    firstDay: stringOr(firstDay, ""),
    lastDay: stringOr(lastDay, ""),
    thickness: thicknessOr(thickness, EVERY_DAY),
    handed: handed === true,
  };
}

/**
 * Nothing worth resuming. The 厚み is not counted: without a range it is not
 * even shown, so a moved slider alone is no draft (and 毎日 is where it starts).
 * Nor is `handed`: a handed 苔片 emptied by hand has nothing left to hand.
 */
export const isEmptyDraft = (draft: Draft): boolean =>
  draft.body === "" &&
  draft.tags.length === 0 &&
  draft.tagText === "" &&
  draft.kind === null &&
  draft.firstDay === "" &&
  draft.lastDay === "";

/** Every field alike — the same 苔片 handed over twice (the link tapped again) moves nothing. */
const sameDraft = (a: Draft, b: Draft): boolean =>
  a.body === b.body &&
  a.tagText === b.tagText &&
  a.kind === b.kind &&
  a.firstDay === b.firstDay &&
  a.lastDay === b.lastDay &&
  a.thickness === b.thickness &&
  a.handed === b.handed &&
  a.tags.length === b.tags.length &&
  a.tags.every((tag, i) => tag === b.tags[i]);

/**
 * At most this many 書きかけ wait aside. A link beyond it opens nothing and
 * says so — the limit refuses, it never drops (2026-11-24 grill ②).
 */
export const MAX_ASIDE = 5;

/** The 書きかけ in the dialog and the ones set aside under it, oldest first. */
export type Drafts = { current: Draft; aside: readonly Draft[] };

/**
 * A 苔片 handed over by a link arrives (渡す, ADR-0009): it takes the dialog,
 * and the 書きかけ there — if there is one — goes on top of the aside. The same
 * 苔片 handed again over itself moves nothing. Null when the aside is full:
 * the link opens nothing, and nothing is lost.
 */
export function receiveHanded(drafts: Drafts, handed: Draft): Drafts | null {
  const { current, aside } = drafts;
  if (isEmptyDraft(current) || sameDraft(current, handed)) return { current: handed, aside };
  if (aside.length >= MAX_ASIDE) return null;
  return { current: handed, aside: [...aside, current] };
}

/** The 書きかけ is spent — 積んだ or 捨てた: the top of the aside comes back, or nothing does. */
export function spend(aside: readonly Draft[]): Drafts {
  const top = aside.at(-1);
  return top === undefined
    ? { current: EMPTY_DRAFT, aside }
    : { current: top, aside: aside.slice(0, -1) };
}

/**
 * What the dialog opens on: the 書きかけ as left — unless it was emptied by
 * hand while some wait aside, and then the top comes back rather than wait
 * under nothing.
 */
export const resume = (drafts: Drafts): Drafts =>
  isEmptyDraft(drafts.current) && drafts.aside.length > 0 ? spend(drafts.aside) : drafts;

/** The stored aside → its drafts; an entry that is not one (or holds nothing) is passed over. */
export function parseAside(raw: string): Draft[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry: unknown) => {
      const draft = draftOf(entry);
      return draft === null || isEmptyDraft(draft) ? [] : [draft];
    });
  } catch {
    return [];
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : parseDraft(raw);
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // No storage — the in-memory state is all there is.
  }
}

/** The 書きかけ and the aside under it, as stored. */
export function loadDrafts(): Drafts {
  let aside: Draft[] = [];
  try {
    const raw = localStorage.getItem(ASIDE_KEY);
    aside = raw === null ? [] : parseAside(raw);
  } catch {
    // No storage — nothing waits aside.
  }
  return { current: loadDraft() ?? EMPTY_DRAFT, aside };
}

export function saveDrafts(drafts: Drafts): void {
  saveDraft(drafts.current);
  try {
    if (drafts.aside.length === 0) localStorage.removeItem(ASIDE_KEY);
    else localStorage.setItem(ASIDE_KEY, JSON.stringify(drafts.aside));
  } catch {
    // No storage — the in-memory state is all there is.
  }
}

/** Logout: a shared machine keeps no 書きかけ — neither the one in the dialog nor any aside. */
export function clearDrafts(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ASIDE_KEY);
  } catch {
    // ignore
  }
}
