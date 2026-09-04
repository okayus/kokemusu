DROP INDEX `post_deleted_at_idx`;--> statement-breakpoint
ALTER TABLE `post` DROP COLUMN `deleted_at`;