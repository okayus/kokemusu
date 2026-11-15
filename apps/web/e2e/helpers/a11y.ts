import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// The WCAG 2.2 A / AA rules only. axe's best-practice rules are left out: they
// are advice, and a red spec has to mean a criterion is broken.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * axe over what is on screen now, once per colour scheme — a contrast that
 * holds in light can fail in dark, and the reverse. `where` names the stop in
 * the failure. Leaves the page in dark.
 */
export async function expectNoAxeViolations(page: Page, where: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const found = violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
    expect.soft(found, `${where} (${colorScheme})`).toEqual([]);
  }
}
