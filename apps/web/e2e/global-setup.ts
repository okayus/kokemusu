import { applyMigrations, resetDb } from "./helpers/db";

// Once per `pnpm e2e`: the e2e D1 receives the migrations (idempotent) and is
// emptied, so the golden path starts from "no user, no 苔片" and today's cell of
// the 総草 is provably at level 0 before the first post. Only the e2e state dir
// (e2e/env.ts) is touched — `pnpm dev` data is left alone.
export default function globalSetup(): void {
  applyMigrations();
  resetDb();
}
