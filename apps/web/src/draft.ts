// localStorage 退避 (plans PR4): a failed submit must never eat the entry.
// The draft is plaintext on the user's own device — same trust boundary as
// the textarea itself; it is cleared on logout so a shared machine keeps
// nothing. Storage can be unavailable (private mode, blocked site data), so
// every access is wrapped and the composer works without it.

const KEY = "kokemusu.draft.v1";

export type Draft = { body: string; tags: string };

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const { body, tags } = parsed as Record<string, unknown>;
    if (typeof body !== "string" || typeof tags !== "string") return null;
    return { body, tags };
  } catch {
    return null;
  }
}

export function saveDraft(draft: Draft): void {
  try {
    if (draft.body === "" && draft.tags === "") localStorage.removeItem(KEY);
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
