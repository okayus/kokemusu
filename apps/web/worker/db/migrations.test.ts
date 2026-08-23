import { describe, expect, it } from "vitest";

// Read the migration SQL through Vite's raw glob rather than node:fs —
// @types/node is not in the dependency tree, and vite/client already types this.
const migrations = import.meta.glob("../../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The one guard that stands between us and the D1 data-loss trap: D1 ignores the
 * `PRAGMA foreign_keys=OFF` that drizzle-kit puts at the top of a table-rebuild
 * migration, so its `DROP TABLE <parent>` cascade-deletes every child row
 * (skill `cloudflare-d1-drizzle-migration`). Rebuilds are what drizzle-kit emits
 * for any column change SQLite can't ALTER in place: NULL → NOT NULL, a type
 * change, a rename.
 *
 * If this fails, the fix is almost never "edit the allowlist". It is to make the
 * change additive instead — a NULLABLE column, a new leaf table, an index. A
 * genuine rebuild means running the skill's backup → apply → row-count runbook
 * by hand and recording the decision here.
 */
const REBUILD_MARKERS = [/\bDROP\s+TABLE\b/i, /\b__new_/i, /\bPRAGMA\s+foreign_keys\s*=\s*OFF/i];

describe("drizzle migrations", () => {
  it("finds the migration files", () => {
    expect(Object.keys(migrations).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(migrations).sort())("%s rebuilds no table", (path) => {
    const sql = migrations[path] ?? "";
    for (const marker of REBUILD_MARKERS) {
      expect(sql, `${path} looks like a table rebuild (matched ${marker})`).not.toMatch(marker);
    }
  });
});
