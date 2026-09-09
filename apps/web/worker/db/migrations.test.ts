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
 * table, an index, or a column drop (0003, 0005). A genuine rebuild means running the
 * skill's backup → apply → row-count runbook by hand and recording it here.
 */
const REBUILD_MARKERS = [/\bDROP\s+TABLE\b/i, /\b__new_/i, /\bPRAGMA\s+foreign_keys\s*=\s*OFF/i];

/**
 * The rebuilds on record, both while the data was small and both exempt from
 * the marker check and pinned statement by statement below instead: 0004
 * (ADR-0005) gave `post` its NOT NULL day axis — which SQLite cannot ADD in
 * place — and 0006 (ADR-0007) carved the 厚み CHECKs into it — which SQLite
 * cannot ADD in place either. The `post_tags` stash around their `DROP TABLE
 * post` is what makes them survive D1. A further entry here is a design
 * review, not a test fix.
 */
const REBUILDS_ON_RECORD = ["/0004_post_day_axis.sql", "/0006_post_thickness.sql"];

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
   * 0003 is the first subtractive migration (0005 below is the second): ADR-0003
   * made deletion physical, so `post.deleted_at` became a column nothing ever
   * writes and 0003 removed it.
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
   * 0005 is the second subtractive one: ADR-0006 retired the 見出し, so
   * `post.title` became a column nothing reads or writes and 0005 removes it.
   * No index ever covered it, so the DROP COLUMN stands alone — a second
   * statement would mean drizzle-kit fell back to a rebuild (see 0003 above).
   */
  it("0005 drops the title column and nothing else", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0005_drop_post_title.sql"));
    expect(path, "0005_drop_post_title.sql is missing").toBeDefined();
    expect(statementsOf(migrations[path ?? ""] ?? "")).toEqual([
      "ALTER TABLE `post` DROP COLUMN `title`",
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

  /**
   * 0006 is the second rebuild on record (ADR-0007), the same recipe as 0004
   * in the same order: stash the links, build the new `post` — now with the
   * three CHECKs that carve core's `Stacking` sum type into the table — copy
   * the rows over with their 厚み backfilled (100 for a range, NULL for a
   * single day: exactly what CHECK 2 requires), drop / rename / index, put the
   * links back, drop the stash. drizzle-kit emitted this rebuild wrapped in
   * `PRAGMA foreign_keys=OFF/ON` and without the stash — the file is
   * hand-written against the 0006 snapshot, which is unchanged.
   */
  it("0006 stashes post_tags, rebuilds post with thickness and the three CHECKs, backfills 100 for a range, restores the links, and nothing else", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0006_post_thickness.sql"));
    expect(path, "0006_post_thickness.sql is missing").toBeDefined();
    expect(statementsOf(migrations[path ?? ""] ?? "")).toEqual([
      "CREATE TABLE `post_tags_keep` AS SELECT * FROM `post_tags`",
      "CREATE TABLE `__new_post` ( `id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `body` text NOT NULL, `body_format` text DEFAULT 'markdown' NOT NULL, `first_day` text NOT NULL, `last_day` text NOT NULL, `thickness` integer, `kind` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade, " +
        "CONSTRAINT `post_days_ordered` CHECK (`first_day` <= `last_day`), " +
        "CONSTRAINT `post_thickness_iff_span` CHECK ((`first_day` = `last_day`) = (`thickness` IS NULL)), " +
        "CONSTRAINT `post_thickness_range` CHECK (`thickness` IS NULL OR `thickness` BETWEEN 1 AND 100) )",
      "INSERT INTO `__new_post` (`id`, `user_id`, `body`, `body_format`, `first_day`, `last_day`, `thickness`, `kind`, `created_at`, `updated_at`) " +
        "SELECT `id`, `user_id`, `body`, `body_format`, `first_day`, `last_day`, CASE WHEN `first_day` < `last_day` THEN 100 ELSE NULL END, `kind`, `created_at`, `updated_at` FROM `post`",
      "DROP TABLE `post`",
      "ALTER TABLE `__new_post` RENAME TO `post`",
      "CREATE INDEX `post_user_id_first_day_created_at_idx` ON `post` (`user_id`,`first_day`,`created_at`)",
      "INSERT OR IGNORE INTO `post_tags` (`post_id`, `tag_id`) SELECT `post_id`, `tag_id` FROM `post_tags_keep`",
      "DROP TABLE `post_tags_keep`",
    ]);
  });

  it("0006 runs no PRAGMA either", () => {
    const path = Object.keys(migrations).find((p) => p.endsWith("/0006_post_thickness.sql"));
    expect(statementsOf(migrations[path ?? ""] ?? "").join(" ")).not.toMatch(/PRAGMA/i);
  });
});
