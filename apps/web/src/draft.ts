// localStorage 退避 (plans PR4): a failed submit must never eat the entry — and
// since the composer became a dialog (features.md §1, 2026-09-05) neither may
// closing it: Esc, the backdrop, a back gesture and 閉じる all leave the draft
// here, so the next open resumes it. Closing is saving, not discarding. Success
// clears it whole: no stones carry over to the next 苔片 by themselves
// (同じ石に積む is the one explicit way they do).
// The draft is plaintext on the user's own device — same trust boundary as the
// textarea itself; it is cleared on logout so a shared machine keeps nothing.
// Storage can be unavailable (private mode, blocked site data), so every access
// is wrapped and the composer works without it.

import { parseKind, type PostKind } from "./kind";

const KEY = "kokemusu.draft.v1";

/**
 * Everything the dialog holds. `firstDay` / `lastDay` are the two date fields
 * as typed (`YYYY-MM-DD`, "" = not chosen = today) — the days 退避 like the
 * body, so a 苔片 half-written for last Tuesday is still last Tuesday's when
 * the dialog comes back.
 */
export type Draft = {
  body: string;
  tags: string;
  kind: PostKind | null;
  firstDay: string;
  lastDay: string;
};

/** A draft with nothing in it — what a fresh dialog starts from and what success leaves. */
export const EMPTY_DRAFT: Draft = {
  body: "",
  tags: "",
  kind: null,
  firstDay: "",
  lastDay: "",
};

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/**
 * The stored JSON → a Draft, or null for anything that is not one. `kind`
 * joined the shape with the 向き radio and the days with 日を選ぶ (2026-09-06);
 * a draft saved before either lacks the field and reads as 未分類 / 今日. A
 * `title` — the 見出し the shape carried from 2026-09-05 until ADR-0006 retired
 * it — is not thrown away: whatever was typed there becomes the body's first
 * line, so a half-written 苔片 loses no words to the change.
 */
export function parseDraft(raw: string): Draft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { title, body, tags, kind, firstDay, lastDay } = parsed as Record<string, unknown>;
    if (typeof body !== "string" || typeof tags !== "string") return null;
    const heading = stringOr(title, "").trim();
    return {
      body: heading === "" ? body : body === "" ? heading : `${heading}\n\n${body}`,
      tags,
      kind: parseKind(kind),
      firstDay: stringOr(firstDay, ""),
      lastDay: stringOr(lastDay, ""),
    };
  } catch {
    return null;
  }
}

export const isEmptyDraft = (draft: Draft): boolean =>
  draft.body === "" &&
  draft.tags === "" &&
  draft.kind === null &&
  draft.firstDay === "" &&
  draft.lastDay === "";

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

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
