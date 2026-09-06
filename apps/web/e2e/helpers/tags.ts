import type { Locator } from "@playwright/test";

// The tag field (src/TagField.tsx) is a combobox with chips: a stone is typed
// and committed with Enter (the highlighted row — the registered stone the
// text spells, else 「…」を新しい石に). `scope` is the dialog or the edit form.

/** Type each name and commit it — the way a hand does. */
export async function fillTags(scope: Locator, names: string[]): Promise<void> {
  const field = scope.getByRole("combobox", { name: "タグ（任意）" });
  for (const name of names) {
    await field.fill(name);
    await field.press("Enter");
  }
}

/** The chips the field shows, by name. */
export const tagChips = (scope: Locator): Locator => scope.locator(".tag-field-chip > span");
