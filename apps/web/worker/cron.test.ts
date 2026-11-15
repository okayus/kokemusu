import { describe, expect, it } from "vitest";
import { sweepExpiredSessions } from "./cron";
import { createDb } from "./db";

describe("sweepExpiredSessions", () => {
  it("deletes only the sessions whose expiry is before the scheduled time", () => {
    const db = createDb(undefined as unknown as D1Database);
    expect(sweepExpiredSessions(db, 1_700_000_000_000).toSQL()).toEqual({
      sql: 'delete from "session" where "session"."expires_at" < ?',
      params: [1_700_000_000_000],
    });
  });
});
