-- 0006 (ADR-0007): the second rebuild of `post` -- `thickness`, and the three CHECKs that carve
-- core's `Stacking` sum type (a single day | a range with a 厚み) into the table. SQLite cannot add
-- a CHECK to an existing table, so `post` is rebuilt the way 0004 was, with the same two changes
-- for D1, which always enforces foreign keys (PRAGMA foreign_keys=OFF is not honoured, so it is
-- not here):
--   * dropping the old `post` cascade-deletes every `post_tags` row, so the links are stashed in
--     a plain table first and restored once the new `post` is in place (OR IGNORE: on a SQLite
--     that did keep them, nothing is inserted twice).
--   * the copy is where every existing 続く苔片 gets its 厚み: 100 (毎日 -- the owner lowers any
--     long look-back by hand afterwards), and every single day NULL, which is what CHECK 2 asks.
-- Runbook (skill cloudflare-d1-drizzle-migration): export before merge, then compare COUNT(*) of
-- post and post_tags after Workers Builds has applied it.
CREATE TABLE `post_tags_keep` AS SELECT * FROM `post_tags`;--> statement-breakpoint
CREATE TABLE `__new_post` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`body_format` text DEFAULT 'markdown' NOT NULL,
	`first_day` text NOT NULL,
	`last_day` text NOT NULL,
	`thickness` integer,
	`kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `post_days_ordered` CHECK (`first_day` <= `last_day`),
	CONSTRAINT `post_thickness_iff_span` CHECK ((`first_day` = `last_day`) = (`thickness` IS NULL)),
	CONSTRAINT `post_thickness_range` CHECK (`thickness` IS NULL OR `thickness` BETWEEN 1 AND 100)
);--> statement-breakpoint
INSERT INTO `__new_post` (`id`, `user_id`, `body`, `body_format`, `first_day`, `last_day`, `thickness`, `kind`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `body`, `body_format`, `first_day`, `last_day`,
	CASE WHEN `first_day` < `last_day` THEN 100 ELSE NULL END,
	`kind`, `created_at`, `updated_at`
FROM `post`;--> statement-breakpoint
DROP TABLE `post`;--> statement-breakpoint
ALTER TABLE `__new_post` RENAME TO `post`;--> statement-breakpoint
CREATE INDEX `post_user_id_first_day_created_at_idx` ON `post` (`user_id`,`first_day`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `post_tags` (`post_id`, `tag_id`) SELECT `post_id`, `tag_id` FROM `post_tags_keep`;--> statement-breakpoint
DROP TABLE `post_tags_keep`;
