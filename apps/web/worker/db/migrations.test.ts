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
 * The one rebuild on record (ADR-0005): 0004 gave `post` its NOT NULL day axis
 * — which SQLite cannot ADD in place — while the data was small. It is exempt
 * from the marker check and pinned statement by statement below instead; the
 * `post_tags` stash around its `DROP TABLE post` is what makes it survive D1.
 * A second entry here is a design review, not a test fix.
 */
const REBUILDS_ON_RECORD = ["/0004_post_day_axis.sql"];

const isRebuildOnRecord = (path: string) => REBUILDS_ON_RECORD.some((tail) => path.endsWith(tail));

/**
 * Every statement of a migration file: `--` comment lines and the drizzle
 * breakpoint stripped, whitespace collapsed, the trailing `;` removed.
 */
const statementsOf = (sql: string): string[] =>
  sql
    .split("--> statement-breakpoint")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/;$/, "")
        .trim(),
    )
    .filter((statement) => statement.length > 0);

describe("drizzle migrations", () => {
  it("finds the migration files", () => {
    expect(Object.keys(migrations).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(migrations).sort().filter((path) => !isRebuildOnRecord(path)))(
    "%s rebuilds no table",
    (path) => {
      const sql = migrations[path] ?? "";
      for (const marker of REBUILD_MARKERS) {
        expect(sql, `${path} looks like a table rebuild (matched ${marker})`).not.toMatch(marker);
      }
    },
  );

  it("exempts only files that exist — a stale entry would hide a new rebuild behind a typo", () => {
    for (const tail of REBUILDS_ON_RECORD) {
      expect(Object.keys(migrations).some((path) => path.endsWith(tail)), tail).toBe(true);
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

  /**
   * 0004 is the rebuild on record (ADR-0005), pinned in the order that keeps
   * the data: the `post_tags` links are copied into a plain table BEFORE the
   * `DROP TABLE post` that cascade-deletes them on D1, and put back AFTER the
   * new `post` has taken the name (so the FK has its target) and its index.
   * The copy into `__new_post` is where every existing 苔片 gets its day —
   * `created_at` cut in Asia/Tokyo (+9h; no DST) for both `first_day` and
   * `last_day`, and `kind` NULL (未分類). drizzle-kit itself emitted an
   * `ALTER TABLE … ADD … NOT NULL`, which SQLite rejects without a default —
   * the file is hand-written against the 0004 snapshot.
   */
  it("0004 stashes post_tags, rebuilds post with the day axis, restores the links, and nothing else", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0004_post_day_axis.sql"));
    expect(path, "0004_post_day_axis.sql is missing").toBeDefined();
    const backfill = "date((`created_at` + 32400000) / 1000, 'unixepoch')";
    expect(statementsOf(migrations[path ?? ""] ?? "")).toEqual([
      "CREATE TABLE `post_tags_keep` AS SELECT * FROM `post_tags`",
      "CREATE TABLE `__new_post` ( `id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `title` text, `body` text NOT NULL, `body_format` text DEFAULT 'markdown' NOT NULL, `first_day` text NOT NULL, `last_day` text NOT NULL, `kind` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade )",
      "INSERT INTO `__new_post` (`id`, `user_id`, `title`, `body`, `body_format`, `first_day`, `last_day`, `kind`, `created_at`, `updated_at`) " +
        `SELECT \`id\`, \`user_id\`, \`title\`, \`body\`, \`body_format\`, ${backfill}, ${backfill}, NULL, \`created_at\`, \`updated_at\` FROM \`post\``,
      "DROP TABLE `post`",
      "ALTER TABLE `__new_post` RENAME TO `post`",
      "CREATE INDEX `post_user_id_first_day_created_at_idx` ON `post` (`user_id`,`first_day`,`created_at`)",
      "INSERT OR IGNORE INTO `post_tags` (`post_id`, `tag_id`) SELECT `post_id`, `tag_id` FROM `post_tags_keep`",
      "DROP TABLE `post_tags_keep`",
    ]);
  });

  it("0004 runs no PRAGMA — D1 would not honour foreign_keys=OFF while a local SQLite would, and the file must do the same thing in both", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0004_post_day_axis.sql"));
    // Statements only: the file's header comment is allowed to say the word.
    expect(statementsOf(migrations[path ?? ""] ?? "").join(" ")).not.toMatch(/PRAGMA/i);
  });
});
