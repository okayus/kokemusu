import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../core/cursor";
import { decryptBody, encryptBody, importBodyKey } from "../core/crypto";
import { normalizeTagName, parseTagNames } from "../core/tag";
import { createDb, type Db } from "../db";
import { post, postTags, tag } from "../db/schema";
import { fail } from "../lib/errors";
import { requireScope, requireSession } from "../middleware/auth";
import type { Env } from "../types";

// Size caps: UTF-16 units, mirrored by the composer's maxLength. Generous for
// a diary, small enough that an encrypted body stays a modest TEXT value.
const MAX_BODY_CHARS = 20_000;
const MAX_TITLE_CHARS = 200;
const MAX_TAGS_PER_POST = 20;
const MAX_TAG_CHARS = 100;

// Exported for direct unit tests: the D1-free test harness cannot get past
// sessionMiddleware, so validation is exercised on the schema itself.
export const createPostSchema = z.object({
  body: z
    .string()
    .min(1)
    .max(MAX_BODY_CHARS)
    .refine((s) => s.trim().length > 0, "body must not be blank"),
  // Optional heading (docs/data-model.md): the composer never sends it, but
  // Phase 2's PAT senders do. Blank collapses to "no heading" in the handler.
  title: z.string().max(MAX_TITLE_CHARS).optional(),
  tags: z.array(z.string().min(1).max(MAX_TAG_CHARS)).max(MAX_TAGS_PER_POST).optional(),
});

export const listPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
  tag: z.string().min(1).max(MAX_TAG_CHARS).optional(),
});

type TagSummary = { id: string; name: string };

/** The one wire shape for a 苔片 — POST returns it, GET returns a page of it. */
type PostItem = {
  id: string;
  title: string | null;
  body: string;
  bodyFormat: string;
  createdAt: number;
  updatedAt: number;
  tags: TagSummary[];
};

// Fail-closed gate on BODY_KEY (ADR-0001): unset or malformed reads as null
// and the route answers 503 before touching a plaintext — importBodyKey never
// logs and never throws the secret.
const getBodyKey = (env: Env["Bindings"]) => importBodyKey(env.BODY_KEY ?? "");

/** Tags of a page of posts, one query, grouped in memory; ordered by norm. */
async function tagsForPosts(db: Db, postIds: string[]): Promise<Map<string, TagSummary[]>> {
  const byPost = new Map<string, TagSummary[]>();
  if (postIds.length === 0) return byPost;
  const rows = await db
    .select({ postId: postTags.postId, id: tag.id, name: tag.name })
    .from(postTags)
    .innerJoin(tag, eq(postTags.tagId, tag.id))
    .where(inArray(postTags.postId, postIds))
    .orderBy(tag.norm);
  for (const row of rows) {
    const list = byPost.get(row.postId) ?? [];
    list.push({ id: row.id, name: row.name });
    byPost.set(row.postId, list);
  }
  return byPost;
}

export const postRoutes = new Hono<Env>()
  // -------------------------------------------------------------- create (苔片を積む)
  // The one PAT-reachable domain route (features.md §7): a session passes the
  // scope gate untouched, a PAT needs post:write. The body is identical for
  // both — nothing in it says who sent it (ADR-0002).
  .post("/", requireScope("post:write"), async (c) => {
    const key = await getBodyKey(c.env);
    if (!key) return fail(c, "encryption_not_configured");

    const parsed = createPostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    const wanted = parseTagNames(parsed.data.tags ?? []);
    if (wanted.some((t) => t.norm === "")) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);

    const existing = wanted.length
      ? await db
          .select({ id: tag.id, name: tag.name, norm: tag.norm })
          .from(tag)
          .where(
            and(
              eq(tag.userId, userId),
              inArray(
                tag.norm,
                wanted.map((t) => t.norm),
              ),
            ),
          )
      : [];

    const now = Date.now();
    const existingNorms = new Set(existing.map((t) => t.norm));
    const newTags = wanted
      .filter((t) => !existingNorms.has(t.norm))
      .map((t) => ({ id: crypto.randomUUID(), userId, name: t.name, norm: t.norm, createdAt: now }));

    // Request-order tag list for the response and the post_tags links.
    const byNorm = new Map<string, TagSummary>();
    for (const t of existing) byNorm.set(t.norm, { id: t.id, name: t.name });
    for (const t of newTags) byNorm.set(t.norm, { id: t.id, name: t.name });
    const resolved = wanted.flatMap((t) => {
      const hit = byNorm.get(t.norm);
      return hit ? [hit] : [];
    });

    // Encrypt at the last moment before the write (ADR-0001); plaintext never
    // rides on an error either — every failure below is a bare 500.
    const titlePlain = parsed.data.title?.trim() ? parsed.data.title.trim() : null;
    const row: typeof post.$inferInsert = {
      id: crypto.randomUUID(),
      userId,
      title: titlePlain === null ? null : await encryptBody(titlePlain, key),
      body: await encryptBody(parsed.data.body, key),
      bodyFormat: "markdown",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    // One atomic batch (D1 wraps it in a transaction): post, then any tags
    // that didn't exist yet, links last so every FK target precedes its
    // reference. If a concurrent request created one of the "new" tags after
    // the SELECT above, the (user_id, norm) UNIQUE index aborts the whole
    // batch — no orphan tags, no half-written post; the retry finds the tag.
    // At single-user scale that race is acceptable as a rare 500.
    await db.batch([
      db.insert(post).values(row),
      ...newTags.map((t) => db.insert(tag).values(t)),
      ...resolved.map((t) => db.insert(postTags).values({ postId: row.id, tagId: t.id })),
    ]);

    const item: PostItem = {
      id: row.id,
      title: titlePlain,
      body: parsed.data.body,
      bodyFormat: row.bodyFormat ?? "markdown",
      createdAt: now,
      updatedAt: now,
      tags: resolved,
    };
    return c.json(item, 201);
  })
  // -------------------------------------------------------------- timeline (新着順)
  // Session-only: the timeline is the decrypted diary, and a post:write token
  // deliberately has no scope that could ever read it (docs/data-model.md —
  // `post:read` 必要になったら). A PAT here answers 403 session_required.
  .get("/", requireSession, async (c) => {
    const key = await getBodyKey(c.env);
    if (!key) return fail(c, "encryption_not_configured");

    const parsed = listPostsQuerySchema.safeParse({
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
      tag: c.req.query("tag"),
    });
    if (!parsed.success) return fail(c, "validation_error");
    const { limit } = parsed.data;
    const cursor = parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === null) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);

    // ?tag= filters by the normalized name. An unknown tag is an empty
    // timeline, not an error — nothing to enumerate against.
    let tagFilterId: string | null = null;
    if (parsed.data.tag !== undefined) {
      const norm = normalizeTagName(parsed.data.tag);
      if (norm === "") return fail(c, "validation_error");
      const hit = (
        await db
          .select({ id: tag.id })
          .from(tag)
          .where(and(eq(tag.userId, userId), eq(tag.norm, norm)))
      )[0];
      if (!hit) return c.json({ posts: [], nextCursor: null });
      tagFilterId = hit.id;
    }

    // Keyset pagination on (created_at DESC, id DESC); `and()` drops the
    // undefined cursor condition on the first page.
    const cursorCond = cursor
      ? or(
          lt(post.createdAt, cursor.createdAt),
          and(eq(post.createdAt, cursor.createdAt), lt(post.id, cursor.id)),
        )
      : undefined;

    let query = db
      .select({
        id: post.id,
        title: post.title,
        body: post.body,
        bodyFormat: post.bodyFormat,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      })
      .from(post)
      .$dynamic();
    if (tagFilterId !== null) {
      // A post carries a tag at most once (PK), so the join cannot fan out.
      query = query.innerJoin(
        postTags,
        and(eq(postTags.postId, post.id), eq(postTags.tagId, tagFilterId)),
      );
    }
    const rows = await query
      .where(and(eq(post.userId, userId), isNull(post.deletedAt), cursorCond))
      .orderBy(desc(post.createdAt), desc(post.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const tagsByPost = await tagsForPosts(
      db,
      page.map((r) => r.id),
    );

    // A decrypt failure (wrong BODY_KEY generation, tampered row) throws and
    // becomes a bare 500 in app.onError — fail closed, never a partial page.
    const posts: PostItem[] = await Promise.all(
      page.map(async (r) => ({
        id: r.id,
        title: r.title === null ? null : await decryptBody(r.title, key),
        body: await decryptBody(r.body, key),
        bodyFormat: r.bodyFormat,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        tags: tagsByPost.get(r.id) ?? [],
      })),
    );

    const last = page[page.length - 1];
    return c.json({
      posts,
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    });
  });
