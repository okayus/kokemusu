-- 0005 (ADR-0006): the 見出し is gone -- drop post.title in place. No index ever covered it,
-- so this is the one statement; like 0003 it is subtractive, not a rebuild (nothing but the column goes,
-- no PRAGMA), and post_tags is untouched. Existing headings (ciphertext) are discarded on purpose.
ALTER TABLE `post` DROP COLUMN `title`;