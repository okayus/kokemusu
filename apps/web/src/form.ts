import type { KeyboardEvent } from "react";

/**
 * ⌘/Ctrl+Enter submits the surrounding form — every field of the composer and
 * the edit form shares it (features.md §1). Returns whether it fired, so a
 * field with keys of its own (TagField) can stop there.
 */
export const submitOnCmdEnter = (
  e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
): boolean => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
    return true;
  }
  return false;
};
