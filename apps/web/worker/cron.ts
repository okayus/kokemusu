import { lt } from "drizzle-orm";
import { createDb, type Db } from "./db";
import { session } from "./db/schema";
import type { Bindings } from "./types";

/**
 * The sessions past their expiry. A presented one is deleted on the spot
 * (middleware/session.ts, the same `expires_at < now`); this catches the ones
 * never presented again — a cleared cookie, another device.
 */
export const sweepExpiredSessions = (db: Db, now: number) =>
  db.delete(session).where(lt(session.expiresAt, now));

// Hourly (wrangler.jsonc triggers). The count goes to the log (`wrangler tail`).
export async function runScheduled(event: ScheduledController, env: Bindings): Promise<void> {
  const result = await sweepExpiredSessions(createDb(env.DB), event.scheduledTime).run();
  console.log("[cron] swept expired sessions:", result.meta.changes);
}
