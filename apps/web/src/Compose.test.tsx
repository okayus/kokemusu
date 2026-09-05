import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComposeDialog, isComposeShortcut, tagsField } from "./Compose";

describe("isComposeShortcut — `n` opens the dialog only when the key would otherwise do nothing", () => {
  const plain = {
    key: "n",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    inEditable: false,
    dialogOpen: false,
  };

  it("fires on a plain n from the page", () => {
    expect(isComposeShortcut(plain)).toBe(true);
  });

  it.each([
    ["another key", { ...plain, key: "m" }],
    ["shift-n (a capital N)", { ...plain, key: "N" }],
    ["⌘n", { ...plain, metaKey: true }],
    ["ctrl+n", { ...plain, ctrlKey: true }],
    ["alt+n", { ...plain, altKey: true }],
    ["mid-IME composition", { ...plain, isComposing: true }],
    ["typing in a field", { ...plain, inEditable: true }],
    ["a dialog already open", { ...plain, dialogOpen: true }],
  ])("stays quiet for %s", (_label, key) => {
    expect(isComposeShortcut(key)).toBe(false);
  });
});

describe("tagsField", () => {
  it("spells the stones the way the edit form does", () => {
    expect(
      tagsField([
        { id: "a", name: "typescript" },
        { id: "b", name: "読書" },
      ]),
    ).toBe("typescript, 読書");
    expect(tagsField([])).toBe("");
  });
});

describe("ComposeDialog", () => {
  // No localStorage in Node: loadDraft reads null, so the fields start from the
  // props alone. Effects (showModal, focus) don't run under
  // renderToStaticMarkup — this is about what the form is seeded with.
  const render = (seedTags: string | null) =>
    renderToStaticMarkup(
      <ComposeDialog
        seedTags={seedTags}
        onCreated={() => {}}
        onClose={() => {}}
        onSessionLost={() => {}}
      />,
    );

  it("seeds the tag field from 同じ石に積む and nothing else", () => {
    const html = render("typescript, 読書");
    expect(html).toContain('value="typescript, 読書"');
    // The body starts empty — only the stones travel (CONTEXT.md).
    expect(html).toMatch(/<textarea[^>]*id="post-body"[^>]*><\/textarea>/);
  });

  it("starts empty without a seed", () => {
    const html = render(null);
    expect(html).toContain('id="post-tags"');
    expect(html).not.toContain('value="typescript');
  });

  it("is a light-dismissable modal named 積む, with the 見出し folded and 閉じる (not やめる)", () => {
    const html = render(null);
    expect(html).toContain('closedby="any"');
    expect(html).toMatch(/<h2 id="[^"]+">積む<\/h2>/);
    expect(html).toContain("見出しを付ける");
    expect(html).not.toMatch(/<details class="compose-title" open/);
    expect(html).toContain(">閉じる</button>");
    expect(html).not.toContain("やめる");
  });
});
