import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TagField } from "./TagField";

const options = [
  { id: "1", name: "typescript" },
  { id: "2", name: "読書" },
];

describe("TagField", () => {
  // Static markup: what the field is before any key — roles, chips, the list.
  it("is a labelled combobox over a hidden listbox, with a hint, and no chips when empty", () => {
    const html = renderToStaticMarkup(
      <TagField id="post-tags" options={options} value={{ tags: [], text: "" }} onChange={() => {}} />,
    );
    expect(html).toContain('<label for="post-tags">タグ（任意）</label>');
    const input = html.match(/<input [^>]*id="post-tags"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-controls="post-tags-options"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-describedby="post-tags-hint"');
    expect(input).toContain('autoComplete="off"');
    expect(input).not.toContain("aria-activedescendant");
    expect(html).toContain('<ul id="post-tags-options" role="listbox" class="tag-field-options" hidden=""');
    expect(html).not.toContain("tag-field-chip");
    expect(html).toContain('id="post-tags-hint"');
  });

  it("shows the chosen stones as chips, each with a remove button named for it", () => {
    const html = renderToStaticMarkup(
      <TagField
        id="post-tags"
        options={options}
        value={{ tags: ["typescript", "苔"], text: "" }}
        onChange={() => {}}
      />,
    );
    expect(html.match(/<li class="tag-field-chip">/g)).toHaveLength(2);
    expect(html).toContain("<span>typescript</span>");
    expect(html).toContain('aria-label="「苔」を外す"');
    // The placeholder is for an empty field only.
    expect(html).not.toContain("placeholder");
  });

  it("renders the rows the text earns — the stones, then 「…」を新しい石に — hidden until focus opens the list", () => {
    const html = renderToStaticMarkup(
      <TagField id="post-tags" options={options} value={{ tags: [], text: "ty" }} onChange={() => {}} />,
    );
    expect(html).toContain('<li id="post-tags-options-0" role="option" aria-selected="false" class="tag-field-option">typescript</li>');
    expect(html).toContain('<li id="post-tags-options-1" role="option" aria-selected="false" class="tag-field-option new">「ty」を新しい石に</li>');
    // Not open (no focus yet): the list is hidden and nothing is highlighted.
    expect(html).toContain('hidden=""');
  });
});
