import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  patTokenFromBytes,
  PAT_TOKEN_BYTES,
  parseScopes,
  SCOPES,
  sha256Hex,
  type Scope,
} from "../core/pat";
import { createDb } from "../db";
import { apiToken } from "../db/schema";
import { fail } from "../lib/errors";
import { getPatPepper } from "../lib/secret";
import { requireSession } from "../middleware/auth";
import type { Env } from "../types";

// Exported for direct unit tests (the D1-free harness stops at the gates).
export const createTokenSchema = z.object({ name: z.string().trim().min(1).max(100) });

const tokenIdSchema = z.string().min(1).max(64);

/** Settings-list row. Never carries token_hash — nothing here can leak a credential. */
type TokenSummary = {
  id: string;
  name: string;
  scopes: Scope[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
};

// PAT management (features.md §7). Session-only end to end — the group in
// index.ts already sits behind requireSession, and the same gate is repeated
// here so a future remount can never accidentally let a PAT mint or revoke
// PATs (an exfiltrated token must stay revocable, not self-renewing).
export const tokenRoutes = new Hono<Env>()
  .use("*", requireSession)
  // ------------------------------------------------------------------- list
  .get("/", async (c) => {
    const rows = await createDb(c.env.DB)
      .select({
        id: apiToken.id,
        name: apiToken.name,
        scopes: apiToken.scopes,
        createdAt: apiToken.createdAt,
        lastUsedAt: apiToken.lastUsedAt,
        expiresAt: apiToken.expiresAt,
        revokedAt: apiToken.revokedAt,
      })
      .from(apiToken)
      .where(eq(apiToken.userId, c.get("userId")))
      .orderBy(desc(apiToken.createdAt));
    const tokens: TokenSummary[] = rows.map((r) => ({ ...r, scopes: parseScopes(r.scopes) }));
    return c.json(tokens);
  })
  // ------------------------------------------------------------------- mint
  .post("/", async (c) => {
    // No pepper, no token — 503 before anything is written, so a PAT can never
    // exist whose hash would die the day PAT_PEPPER is finally set.
    const pepper = getPatPepper(c.env);
    if (!pepper) return fail(c, "pat_not_configured");

    const parsed = createTokenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");

    const token = patTokenFromBytes(crypto.getRandomValues(new Uint8Array(PAT_TOKEN_BYTES)));
    const tokenHash = await sha256Hex(token + pepper);
    const now = Date.now();
    // MVP: every token gets the full (one-entry) set; a picker can come later.
    const scopes: Scope[] = [...SCOPES];
    const row: typeof apiToken.$inferInsert = {
      id: crypto.randomUUID(),
      userId: c.get("userId"),
      name: parsed.data.name,
      tokenHash,
      scopes: JSON.stringify(scopes),
      createdAt: now,
    };
    await createDb(c.env.DB).insert(apiToken).values(row);

    // The raw token exists on the wire exactly once — here. The list above
    // will never show it again, and D1 only ever held the hash.
    return c.json(
      { id: row.id, name: row.name, token, scopes, createdAt: now },
      201,
    );
  })
  // ----------------------------------------------------------------- revoke
  .delete("/:id", async (c) => {
    const id = tokenIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, "validation_error");
    const db = createDb(c.env.DB);

    // Not yours and nonexistent answer the same 404 — no existence oracle.
    const owned = (
      await db
        .select({ id: apiToken.id, revokedAt: apiToken.revokedAt })
        .from(apiToken)
        .where(and(eq(apiToken.id, id.data), eq(apiToken.userId, c.get("userId"))))
        .limit(1)
    )[0];
    if (!owned) return fail(c, "not_found");

    // Idempotent: a second revoke succeeds without moving the time of death.
    if (owned.revokedAt === null) {
      await db.update(apiToken).set({ revokedAt: Date.now() }).where(eq(apiToken.id, owned.id));
    }
    return c.json({});
  });
