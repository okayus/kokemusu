import { execFileSync } from "node:child_process";
import { E2E_PERSIST_DIR } from "../env";

// `--local` and the e2e state dir are hardcoded into every invocation: this
// helper has no code path that could reach the production D1 or the `pnpm dev`
// database. Runs with cwd = apps/web (what `pnpm e2e` gives it), where
// wrangler.jsonc names the database and the migrations directory.
function wrangler(args: string[]): string {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], { stdio: "pipe", encoding: "utf8" });
}

/** Idempotent: applies drizzle/*.sql to the e2e sqlite, creating it on the first run. */
export function applyMigrations(): void {
  wrangler(["d1", "migrations", "apply", "kokemusu-db", "--local", "--persist-to", E2E_PERSIST_DIR]);
}

export function executeSql(sql: string): void {
  wrangler(["d1", "execute", "kokemusu-db", "--local", "--persist-to", E2E_PERSIST_DIR, "--command", sql]);
}

/** Rows of a single SELECT, read straight from the e2e sqlite — what is AT REST, not what the API decrypts. */
export function queryRows<T>(sql: string): T[] {
  const out = wrangler([
    "d1", "execute", "kokemusu-db", "--local", "--persist-to", E2E_PERSIST_DIR, "--json", "--command", sql,
  ]);
  const [first] = JSON.parse(out) as { results: T[] }[];
  return first?.results ?? [];
}

/** Empty every table, children before parents (the FKs cascade; be explicit anyway). */
export function resetDb(): void {
  executeSql(
    [
      "DELETE FROM post_tags",
      "DELETE FROM post",
      "DELETE FROM tag",
      "DELETE FROM api_token",
      "DELETE FROM session",
      "DELETE FROM credential",
      "DELETE FROM user",
    ].join("; "),
  );
}
