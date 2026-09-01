import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { createDb } from "../db";
import { tag } from "../db/schema";
import type { Env } from "../types";

// Session-guarded by the protected /api mount. Feeds the composer's
// <datalist> completion; archived stones stay out of the suggestions.
export const tagRoutes = new Hono<Env>().get("/", async (c) => {
  const rows = await createDb(c.env.DB)
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .where(and(eq(tag.userId, c.get("userId")), isNull(tag.archivedAt)))
    .orderBy(tag.norm);
  return c.json(rows);
});
