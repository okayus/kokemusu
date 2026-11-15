import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { postTags, tag } from "../db/schema";
import type { Env } from "../types";

// Session-guarded by the protected /api mount. Feeds the tag field's
// suggestions. Archived stones stay out, and so do stones no 苔片 wears: a
// stone is minted only by putting it on a 苔片, so an empty one is debris (a
// 付け替え emptied it, a typo was taken off). The row stays — the same
// spelling stacked again lands on the same stone (id, color).
export const tagRoutes = new Hono<Env>().get("/", async (c) => {
  const db = createDb(c.env.DB);
  const worn = db
    .select({ one: sql`1` })
    .from(postTags)
    .where(eq(postTags.tagId, tag.id));
  const rows = await db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(and(eq(tag.userId, c.get("userId")), isNull(tag.archivedAt), exists(worn)))
    .orderBy(tag.norm);
  return c.json(rows);
});
