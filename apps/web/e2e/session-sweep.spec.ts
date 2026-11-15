import { expect, test } from "@playwright/test";
import { executeSql, queryRows } from "./helpers/db";

// The hourly Cron's work (worker/cron.ts) through the shipped scheduled
// handler, which wrangler dev's /cdn-cgi/local/scheduled invokes once: a
// session past its expiry goes, a live one stays. The rows hang off a user of
// their own, so the spec also runs alone, and they are deleted after.
test("the scheduled handler sweeps the expired sessions and keeps the live ones", async ({
  request,
}) => {
  const now = Date.now();
  executeSql(
    [
      `INSERT INTO user (id, display_name, created_at) VALUES ('sweep-user', 'sweep', ${now})`,
      `INSERT INTO session (id, user_id, expires_at, created_at) VALUES ('sweep-expired', 'sweep-user', ${now - 1_000}, ${now - 2_000})`,
      `INSERT INTO session (id, user_id, expires_at, created_at) VALUES ('sweep-live', 'sweep-user', ${now + 86_400_000}, ${now})`,
    ].join("; "),
  );
  try {
    const res = await request.get("/cdn-cgi/local/scheduled");
    expect(res.ok()).toBe(true);
    // The handler's work rides on ctx.waitUntil, which the response does not wait for.
    await expect
      .poll(() =>
        queryRows<{ id: string }>("SELECT id FROM session WHERE user_id = 'sweep-user'").map(
          (r) => r.id,
        ),
      )
      .toEqual(["sweep-live"]);
  } finally {
    executeSql("DELETE FROM session WHERE user_id = 'sweep-user'; DELETE FROM user WHERE id = 'sweep-user'");
  }
});
