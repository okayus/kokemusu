import type { Bindings } from "./types";

// Skeleton stub: log only. Proves the Cron trigger is registered (visible in
// `wrangler tail`) without any external dependency. Real scheduled work
// (session sweep, backups, ...) lands in a later phase.
export async function runScheduled(event: ScheduledController, _env: Bindings): Promise<void> {
  console.log("[cron] fired at", new Date(event.scheduledTime).toISOString());
}
