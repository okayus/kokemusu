import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only — it diffs the schema against drizzle/meta and
// writes SQL, with no database connection, so the sandbox needs no Cloudflare
// credentials. Applying is wrangler's job (`pnpm db:migrate` locally, the
// Workers Builds deploy command in production), which is why `driver: "d1-http"`
// and `dbCredentials` are deliberately absent: `push` / `migrate` / `studio`
// would bypass the migration files that wrangler tracks in `d1_migrations`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  // Same directory as wrangler.jsonc's `migrations_dir`, so generated files are
  // picked up with no extra wiring.
  out: "./drizzle",
});
