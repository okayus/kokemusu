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
 * If this fails, the fix is almost never "edit the allowlist". It is to reshape
 * the change into one SQLite can do in place — a NULLABLE column, a new leaf
 * table, an index, or a column drop (0003). A genuine rebuild means running the
 * skill's backup → apply → row-count runbook by hand and recording it here.
 */
const REBUILD_MARKERS = [/\bDROP\s+TABLE\b/i, /\b__new_/i, /\bPRAGMA\s+foreign_keys\s*=\s*OFF/i];

/**
 * Every statement of a migration file, `;` and the drizzle breakpoint stripped.
 */
const statementsOf = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim().replace(/;$/, ""))
    .filter((statement) => statement.length > 0);

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

  /**
   * 0003 is the one subtractive migration: ADR-0003 made deletion physical, so
   * `post.deleted_at` became a column nothing ever writes and 0003 removed it.
   * SQLite drops a column in place — no rebuild — but only while no index
   * covers it, which is why `DROP INDEX` has to come first. Any third statement
   * (a `CREATE TABLE` above all) would mean drizzle-kit fell back to a rebuild,
   * and `post` is the CASCADE parent of `post_tags`: its `DROP TABLE` would
   * take every tag link with it. REBUILD_MARKERS above would also catch that;
   * this pins what the file should positively be, in the order it must run.
   */
  it("0003 drops the index, then the column, and nothing else", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0003_drop_post_deleted_at.sql"));
    expect(path, "0003_drop_post_deleted_at.sql is missing").toBeDefined();
    expect(statementsOf(migrations[path ?? ""] ?? "")).toEqual([
      "DROP INDEX `post_deleted_at_idx`",
      "ALTER TABLE `post` DROP COLUMN `deleted_at`",
    ]);
  });
});
