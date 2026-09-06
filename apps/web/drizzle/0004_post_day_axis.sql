-- 0004 (ADR-0005): the one rebuild of `post` -- first_day / last_day (NOT NULL) and kind.
-- SQLite cannot ADD a NOT NULL column to an existing table without a default, so the
-- table is rebuilt the way drizzle-kit does it, with two changes for D1, which always
-- enforces foreign keys (PRAGMA foreign_keys=OFF is not honoured, so it is not here):
--   * `DROP TABLE post` cascade-deletes every `post_tags` row, so the links are stashed
--     in a plain table first and restored once the new `post` is in place
--     (OR IGNORE: on a SQLite that did keep them, nothing is inserted twice).
--   * every existing 苔片 was stacked "now", so its day is created_at cut in Asia/Tokyo:
--     +9h with no DST -- a one-time use of SQLite's UTC date() that app code never makes
--     (core/day.ts decides days on the write side, with Intl).
-- Runbook (skill cloudflare-d1-drizzle-migration): export before merge, then compare
-- COUNT(*) of post and post_tags after Workers Builds has applied it.
CREATE TABLE `post_tags_keep` AS SELECT * FROM `post_tags`;--> statement-breakpoint
CREATE TABLE `__new_post` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`body_format` text DEFAULT 'markdown' NOT NULL,
	`first_day` text NOT NULL,
	`last_day` text NOT NULL,
	`kind` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_post` (`id`, `user_id`, `title`, `body`, `body_format`, `first_day`, `last_day`, `kind`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `title`, `body`, `body_format`,
	date((`created_at` + 32400000) / 1000, 'unixepoch'),
	date((`created_at` + 32400000) / 1000, 'unixepoch'),
	NULL, `created_at`, `updated_at`
FROM `post`;--> statement-breakpoint
DROP TABLE `post`;--> statement-breakpoint
ALTER TABLE `__new_post` RENAME TO `post`;--> statement-breakpoint
CREATE INDEX `post_user_id_first_day_created_at_idx` ON `post` (`user_id`,`first_day`,`created_at`);--> statement-breakpoint
INSERT OR IGNORE INTO `post_tags` (`post_id`, `tag_id`) SELECT `post_id`, `tag_id` FROM `post_tags_keep`;--> statement-breakpoint
DROP TABLE `post_tags_keep`;
