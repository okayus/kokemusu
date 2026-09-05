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

const KEY = "kokemusu.draft.v1";

export type Draft = { title: string; body: string; tags: string };

/**
 * The stored JSON → a Draft, or null for anything that is not one. `title`
 * joined the shape with the 見出し toggle (2026-09-05); a draft saved before
 * that lacks the field and reads as 見出しなし.
 */
export function parseDraft(raw: string): Draft | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { title, body, tags } = parsed as Record<string, unknown>;
    if (typeof body !== "string" || typeof tags !== "string") return null;
    return { title: typeof title === "string" ? title : "", body, tags };
  } catch {
    return null;
  }
}

export const isEmptyDraft = (draft: Draft): boolean =>
  draft.title === "" && draft.body === "" && draft.tags === "";

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
