import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../core/cursor";
import { decryptBody, encryptBody, importBodyKey } from "../core/crypto";
import { dayKey, isDayKey, type DayKey } from "../core/day";
import {
  decodeStacking,
  encodeStacking,
  parseStacking,
  patchStacking,
  thicknessSchema,
} from "../core/stacking";
import { POST_KINDS, type PostKind } from "../core/kind";
import {
  MAX_TAGS_PER_POST,
  MAX_TAGS_PER_SET,
  normalizeTagName,
  parseTagNames,
  parseTagsParam,
} from "../core/tag";
import { createDb, type Db } from "../db";
import { post, postTags, tag } from "../db/schema";
import { fail } from "../lib/errors";
import { requireScope, requireSession } from "../middleware/auth";
import type { Env } from "../types";

// Size caps: UTF-16 units, mirrored by the composer's maxLength. Generous for
// a diary, small enough that an encrypted body stays a modest TEXT value.
// (MAX_TAGS_PER_POST lives in core/tag.ts, derived from D1's bound parameters
// per statement against resolveTagRows below; the `?tags=` set has its own
// cap there, MAX_TAGS_PER_SET.)
const MAX_BODY_CHARS = 20_000;
const MAX_TAG_CHARS = 100;

// Exported for direct unit tests: the D1-free test harness cannot get past
// sessionMiddleware, so validation is exercised on the schema itself.
//
// strictObject: a key the shape does not name is a 400, never silently dropped
// (ADR-0006) — a sender still sending the retired `title` is told so, where
// zod's default would have swallowed its heading without a word back.
export const createPostSchema = z.strictObject({
  body: z
    .string()
    .min(1)
    .max(MAX_BODY_CHARS)
    .refine((s) => s.trim().length > 0, "body must not be blank"),
  tags: z.array(z.string().min(1).max(MAX_TAG_CHARS)).max(MAX_TAGS_PER_POST).optional(),
  // 向き (core/kind.ts): one of the three, or nothing — absent and null both
  // read as 未分類, so a sender that spells "no 向き" explicitly is not turned
  // away. The same field on PATCH: the edit form sends the whole state, so an
  // omitted 向き clears it.
  kind: z.enum(POST_KINDS).nullable().optional(),
  // The days to stack on (ADR-0005, features.md §1): calendar days here, the
  // order and the bounds in the handler, which knows today — `firstDay ≤
  // lastDay ≤ today`, no earlier than core's floor (parseStacking); a 400 for
  // anything else. On POST an omitted `firstDay` is today and an omitted
  // `lastDay` is `firstDay`; on PATCH an omitted half keeps the row's own
  // day (an edit that says nothing about the days moves nothing — the way
  // to lengthen a 続く苔片 is a PATCH naming its new `lastDay`).
  firstDay: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
  lastDay: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
  // 厚み (ADR-0007): a whole 1..100, null, or nothing — zod holds the shape and
  // the range. What it MEANS with the days is core's (parseStacking): a range
  // must carry one and a single day must not, else 400; on PATCH absent keeps
  // the row's, null says none (with the days that make it a single day), a
  // number replaces it (patchStacking).
  thickness: thicknessSchema.nullable().optional(),
});

// The feed's filter (features.md §3): stones and a period, AND together — one
// wire form for three routes, the timeline (GET /), its count (GET /count) and
// 付け替え (PATCH /), so what the reader sees narrowed is exactly what is
// counted and what is retagged.
//
// The two tag filter forms: `?tag=` = one tag by (normalized) name —
// hand-writable; `?tags=` = a 2+ tag AND set by id, the same wire 規約 as the
// 年表's deep-dive rows (core/tag.ts) so §6's edge tap and a §8 row land here
// symmetrically. They are exclusive — a request mixing them has no meaning.
//
// The period (features.md §3): `?from=` / `?to=` are inclusive calendar days,
// the 総草's own wire form — so 日・週・月・年 and a custom range are all one
// shape. A 苔片 is in the period when its days OVERLAP it (ADR-0005:
// `first_day <= to AND last_day >= from`) — plain string comparison on the day
// axis, no zone in the read. Each half stands alone (`from` = それ以降, `to` =
// それ以前); together they must not invert. `9999-12-31` as `to` stays a 400:
// the rule dates from the instant window that needed `to + 1`, and A1 changes
// no behaviour on the wire.
export const feedFilterSchema = z
  .object({
    tag: z.string().min(1).max(MAX_TAG_CHARS).optional(),
    tags: z.string().min(1).max(1400).optional(),
    from: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
    to: z.string().refine(isDayKey, "must be a YYYY-MM-DD calendar day").optional(),
  })
  .refine((q) => q.tag === undefined || q.tags === undefined, "tag and tags are exclusive")
  .refine(
    (q) => q.from === undefined || q.to === undefined || q.from <= q.to,
    "from must not be after to",
  )
  .refine((q) => q.to !== "9999-12-31", "to must be a day before the end of the calendar");

// The page on top of the filter (zod 4 keeps the refinements across extend).
export const listPostsQuerySchema = feedFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});

// 付け替え's filter: the feed's, with a stone required. A period alone would
// name a season of the whole diary, and the diary is not a thing to retag by
// accident — the UI shows the form only while a stone narrows the feed, and
// the wire says the same.
export const retagFilterSchema = feedFilterSchema.refine(
  (q) => q.tag !== undefined || q.tags !== undefined,
  "a stone is required",
);

/**
 * 付け替え's change (features.md §2, CONTEXT.md): the stones to put on every
 * 苔片 of the filter, by name — a new spelling mints a stone, as on 積む — and
 * the stones to take off, by id (the filter's own, in the UI; any of the
 * reader's on the wire). One of the two at least. Strict like the composer's:
 * a key the shape does not name is a 400, never silently dropped (ADR-0006).
 */
export const retagSchema = z
  .strictObject({
    add: z.array(z.string().min(1).max(MAX_TAG_CHARS)).max(MAX_TAGS_PER_POST).optional(),
    remove: z.array(z.string().min(1).max(64)).max(MAX_TAGS_PER_SET).optional(),
  })
  .refine((b) => (b.add?.length ?? 0) + (b.remove?.length ?? 0) > 0, "nothing to change");

/**
 * The overlap of a 苔片's days with the period, as the SQL the feed ANDs onto
 * its other filters: `last_day >= from` and `first_day <= to`, an absent half
 * dropped (undefined when both are). Exported for the unit tests, which have
 * no D1: they pin which column meets which bound — the mix-up ADR-0005 warned
 * about — and e2e checks the rows.
 */
export function periodCondition(query: {
  from?: string | undefined;
  to?: string | undefined;
}): SQL | undefined {
  return and(
    query.from === undefined ? undefined : gte(post.lastDay, query.from),
    query.to === undefined ? undefined : lte(post.firstDay, query.to),
  );
}

type FeedFilter = z.infer<typeof feedFilterSchema>;

type StoneFilter = { kind: "invalid" } | { kind: "none" } | { kind: "stones"; ids: string[] };

/**
 * The stones a filter names, as ids. `?tag=` goes by its normalized name: an
 * unknown one is `none` — an empty feed, not an error, nothing to enumerate
 * against — and a blank spelling `invalid`. `?tags=` is the ids as they are
 * (an unknown id makes the set match nothing, like an unknown ?tag=; the user
 * condition in feedCondition keeps a foreign id from ever selecting foreign
 * posts). No stone at all is the empty set.
 */
async function resolveStones(db: Db, userId: string, filter: FeedFilter): Promise<StoneFilter> {
  if (filter.tag !== undefined) {
    const norm = normalizeTagName(filter.tag);
    if (norm === "") return { kind: "invalid" };
    const hit = (
      await db
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.userId, userId), eq(tag.norm, norm)))
    )[0];
    return hit ? { kind: "stones", ids: [hit.id] } : { kind: "none" };
  }
  if (filter.tags !== undefined) {
    const ids = parseTagsParam(filter.tags);
    return ids === null ? { kind: "invalid" } : { kind: "stones", ids };
  }
  return { kind: "stones", ids: [] };
}

/**
 * The feed's filter as SQL over `post`: the user's rows carrying EVERY stone
 * of the set — post ids where COUNT(DISTINCT tag_id ∈ set) = n, the 年表's
 * ?tags= row's SQL (data-model.md 集計節); one stone needs no count, none is
 * no condition — whose days overlap the period (periodCondition). Subqueries
 * rather than a join, so the one condition narrows an UPDATE, a DELETE and an
 * INSERT … SELECT as it narrows the page: 付け替え writes through it, and its
 * parameters do not grow with the number of 苔片. Exported for the unit tests.
 */
export function feedCondition(
  db: Db,
  userId: string,
  stoneIds: readonly string[],
  period: { from?: string | undefined; to?: string | undefined },
): SQL {
  const [only] = stoneIds;
  const stoneCond =
    only === undefined
      ? undefined
      : stoneIds.length === 1
        ? inArray(
            post.id,
            db.select({ postId: postTags.postId }).from(postTags).where(eq(postTags.tagId, only)),
          )
        : inArray(
            post.id,
            db
              .select({ postId: postTags.postId })
              .from(postTags)
              .where(inArray(postTags.tagId, [...stoneIds]))
              .groupBy(postTags.postId)
              .having(eq(countDistinct(postTags.tagId), stoneIds.length)),
          );
  // Never undefined: the user condition is always there.
  return and(eq(post.userId, userId), stoneCond, periodCondition(period)) as SQL;
}

/**
 * The statements of one 付け替え, in the order the batch runs them — an order
 * that keeps the filter true until the last statement: the count and the
 * touch first, new stones before any link that references them (FK), the
 * links put on before any taken off — a 苔片 that loses a filtered stone
 * leaves the filter, and it must have gained its new stones first. Each
 * statement's subquery is evaluated against the table as it was before that
 * statement (rehearsed on the local D1, 2026-09-27), so a DELETE through a
 * filter naming the very stone it removes takes every 苔片 of the set, not the
 * first alone. `cond` is feedCondition's. Exported for the unit tests, which
 * pin the SQL each statement writes through the filter.
 */
export function retagStatements(
  db: Db,
  input: {
    cond: SQL;
    now: number;
    newTags: (typeof tag.$inferInsert)[];
    addIds: string[];
    removeIds: string[];
  },
) {
  const { cond } = input;
  const matched = () => db.select({ id: post.id }).from(post).where(cond);
  const link = (tagId: string) =>
    db
      .select({ one: sql`1` })
      .from(postTags)
      .where(and(eq(postTags.postId, post.id), eq(postTags.tagId, tagId)));
  // updated_at moves on exactly the 苔片 whose stones change: one lacking a
  // stone being put on, or carrying one being taken off. A new stone is on
  // no 苔片 yet, so with one every matched 苔片 changes (no condition).
  const changeCond =
    input.newTags.length > 0
      ? undefined
      : or(
          ...input.addIds.map((id) => notExists(link(id))),
          ...input.removeIds.map((id) => exists(link(id))),
        );
  return [
    db.select({ n: count() }).from(post).where(cond),
    db
      .update(post)
      .set({ updatedAt: input.now })
      .where(and(cond, changeCond)),
    ...input.newTags.map((t) => db.insert(tag).values(t)),
    ...input.addIds.map((id) =>
      db
        .insert(postTags)
        .select(
          db
            .select({ postId: post.id, tagId: sql<string>`${id}`.as("tag_id") })
            .from(post)
            .where(cond),
        )
        .onConflictDoNothing(),
    ),
    ...input.removeIds.map((id) =>
      db
        .delete(postTags)
        .where(and(eq(postTags.tagId, id), inArray(postTags.postId, matched()))),
    ),
  ] as const;
}

/** The feed's filter, read off the query string (the same four keys for all three routes). */
const filterQuery = (c: Context<Env>) => ({
  tag: c.req.query("tag"),
  tags: c.req.query("tags"),
  from: c.req.query("from"),
  to: c.req.query("to"),
});

// The :id of PATCH/DELETE. Bounded like tokens' id schema — the shape says
// nothing about existence; unknown and foreign ids share one 404 later.
const postIdSchema = z.string().min(1).max(64);

type TagSummary = { id: string; name: string };

/** The one wire shape for a 苔片 — POST returns it, GET returns a page of it. */
type PostItem = {
  id: string;
  body: string;
  bodyFormat: string;
  createdAt: number;
  updatedAt: number;
  /** First and last 「日」 this 苔片 was there (ADR-0005) — `YYYY-MM-DD` in APP_TZ, equal for a single day. */
  firstDay: DayKey;
  lastDay: DayKey;
  /** 厚み of a 続く苔片, a whole 1..100 (ADR-0007); null ⇔ a single day — the row's own shape. */
  thickness: number | null;
  /** The day it was written on, `dayKey(createdAt)`. 「いま積んだ」 = all three days equal; the client only compares. */
  postedDay: DayKey;
  /** 向き (core/kind.ts); null = 未分類. */
  kind: PostKind | null;
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

/**
 * Resolve requested tag names for a write: existing stones by (user, norm),
 * the rest minted with fresh ids. `resolved` keeps request order for the
 * response and the post_tags links; the caller must batch `newTags`' INSERTs
 * before any link that references them (FK).
 */
async function resolveTagRows(
  db: Db,
  userId: string,
  wanted: { name: string; norm: string }[],
  now: number,
) {
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
  return { newTags, resolved };
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

    const now = Date.now();
    // The one place the zone enters (core/day.ts): today's 「日」 is where a
    // 苔片 lands when the body names no day, and the ceiling for one that does
    // — a past day, or a range that makes it a 続く苔片 (ADR-0005). The days and
    // the 厚み are READ into a Stacking after the schema (core/stacking.ts —
    // only this handler knows today), and a body naming nothing the type has
    // a case for — a range without a 厚み, a single day with one, a day that
    // has not come — is the same 400 as a malformed one (ADR-0007).
    const today = dayKey(now);
    const stacking = parseStacking(parsed.data, today);
    if (stacking === null) return fail(c, "validation_error");
    const days = encodeStacking(stacking);
    const kind = parsed.data.kind ?? null;
    const { newTags, resolved } = await resolveTagRows(db, userId, wanted, now);

    // Encrypt at the last moment before the write (ADR-0001); plaintext never
    // rides on an error either — every failure below is a bare 500.
    const row: typeof post.$inferInsert = {
      id: crypto.randomUUID(),
      userId,
      body: await encryptBody(parsed.data.body, key),
      bodyFormat: "markdown",
      ...days,
      kind,
      createdAt: now,
      updatedAt: now,
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
      body: parsed.data.body,
      bodyFormat: row.bodyFormat ?? "markdown",
      createdAt: now,
      updatedAt: now,
      ...days,
      postedDay: today,
      kind,
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
      ...filterQuery(c),
    });
    if (!parsed.success) return fail(c, "validation_error");
    const { limit } = parsed.data;
    const cursor = parsed.data.cursor === undefined ? null : decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === null) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);

    // The stones of the filter (resolveStones): a stone that does not exist
    // is an empty timeline, not an error.
    const stones = await resolveStones(db, userId, parsed.data);
    if (stones.kind === "invalid") return fail(c, "validation_error");
    if (stones.kind === "none") {
      return c.json({ posts: [], nextCursor: null, today: dayKey(Date.now()) });
    }

    // Keyset pagination on (first_day DESC, created_at DESC, id DESC) — the
    // 「日」 first (ADR-0005), so a 苔片 stacked on a past day sits on that day
    // and a 続く苔片 at its first day, not at the top; within a day, the order
    // written. `and()` drops the undefined cursor condition on the first page.
    const cursorCond = cursor
      ? or(
          lt(post.firstDay, cursor.firstDay),
          and(eq(post.firstDay, cursor.firstDay), lt(post.createdAt, cursor.createdAt)),
          and(
            eq(post.firstDay, cursor.firstDay),
            eq(post.createdAt, cursor.createdAt),
            lt(post.id, cursor.id),
          ),
        )
      : undefined;

    // The filter (feedCondition) — the stones, and the period as an overlap on
    // the very axis the cursor walks — composes with the cursor as plain AND
    // on post(user_id, first_day, created_at): a page under a filter is the
    // same page of the same order, minus the 苔片 that miss it.
    const rows = await db
      .select({
        id: post.id,
        body: post.body,
        bodyFormat: post.bodyFormat,
        firstDay: post.firstDay,
        lastDay: post.lastDay,
        thickness: post.thickness,
        kind: post.kind,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      })
      .from(post)
      .where(and(feedCondition(db, userId, stones.ids, parsed.data), cursorCond))
      .orderBy(desc(post.firstDay), desc(post.createdAt), desc(post.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const tagsByPost = await tagsForPosts(
      db,
      page.map((r) => r.id),
    );

    // A decrypt failure (wrong BODY_KEY generation, tampered row) throws and
    // becomes a bare 500 in app.onError — fail closed, never a partial page.
    // The days go out the same way: read as a Stacking and written back, so a
    // row the CHECKs would have refused (decodeStacking) fails the page too.
    const posts: PostItem[] = await Promise.all(
      page.map(async (r) => ({
        id: r.id,
        body: await decryptBody(r.body, key),
        bodyFormat: r.bodyFormat,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        ...encodeStacking(decodeStacking(r)),
        postedDay: dayKey(r.createdAt),
        kind: r.kind,
        tags: tagsByPost.get(r.id) ?? [],
      })),
    );

    // `today` rides along like the 年表's axis edge: the server decides "today"
    // for every view that cuts days (stats.ts), and the feed's period presets
    // (今日 / 今週 / 今月 / 今年) are anchored on it rather than on a client
    // clock that may sit in another zone.
    const last = page[page.length - 1];
    return c.json({
      posts,
      nextCursor:
        hasMore && last
          ? encodeCursor({ firstDay: last.firstDay, createdAt: last.createdAt, id: last.id })
          : null,
      today: dayKey(Date.now()),
    });
  })
  // ------------------------------------------------------- count (絞り込みの片数)
  // How many 苔片 the filter holds, loaded pages or not — what 付け替え's form
  // says before anything is written (features.md §2). Session-only like the
  // timeline it counts.
  .get("/count", requireSession, async (c) => {
    const parsed = feedFilterSchema.safeParse(filterQuery(c));
    if (!parsed.success) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);
    const stones = await resolveStones(db, userId, parsed.data);
    if (stones.kind === "invalid") return fail(c, "validation_error");
    if (stones.kind === "none") return c.json({ count: 0 });

    const [row] = await db
      .select({ n: count() })
      .from(post)
      .where(feedCondition(db, userId, stones.ids, parsed.data));
    return c.json({ count: row?.n ?? 0 });
  })
  // ------------------------------------------------ 付け替え (まとめて石を付け替える)
  // PATCH on the collection, narrowed by the feed's own filter (features.md
  // §2, CONTEXT.md 付け替え): every 苔片 the reader sees narrowed to — loaded or
  // not — gains the stones in `add` and loses those in `remove`, in one
  // transaction, and nothing else about it moves. Session-only: rewriting
  // history is no business of a post:write PAT (403 session_required).
  .patch("/", requireSession, async (c) => {
    // The body is read before the query string is judged: a refusal that
    // leaves a body unread trips wrangler dev's proxy (e2e/README.md) — and
    // both are the same 400 anyway.
    const parsed = retagSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    const filter = retagFilterSchema.safeParse(filterQuery(c));
    if (!filter.success) return fail(c, "validation_error");
    const wanted = parseTagNames(parsed.data.add ?? []);
    if (wanted.some((t) => t.norm === "")) return fail(c, "validation_error");
    const removeIds = [...new Set(parsed.data.remove ?? [])];

    const userId = c.get("userId");
    const db = createDb(c.env.DB);
    const stones = await resolveStones(db, userId, filter.data);
    if (stones.kind === "invalid") return fail(c, "validation_error");
    if (stones.kind === "none") return c.json({ matched: 0, changed: 0 });

    // The stones to take off must be the reader's own: an unknown or foreign
    // id is a malformed request (400), not a silent no-op — the UI offers only
    // stones that exist. And a stone cannot be put on and taken off at once.
    if (removeIds.length > 0) {
      const owned = await db
        .select({ id: tag.id })
        .from(tag)
        .where(and(eq(tag.userId, userId), inArray(tag.id, removeIds)));
      if (owned.length !== removeIds.length) return fail(c, "validation_error");
    }
    const now = Date.now();
    const { newTags, resolved } = await resolveTagRows(db, userId, wanted, now);
    if (resolved.some((t) => removeIds.includes(t.id))) return fail(c, "validation_error");

    // One atomic batch (retagStatements), every statement writing THROUGH the
    // filter: the 苔片 are never enumerated into a parameter list, so a filter
    // of a thousand 苔片 costs the same statements as one of three.
    const [counted, touched] = await db.batch(
      retagStatements(db, {
        cond: feedCondition(db, userId, stones.ids, filter.data),
        now,
        newTags,
        addIds: resolved.map((t) => t.id),
        removeIds,
      }),
    );
    return c.json({ matched: counted[0]?.n ?? 0, changed: touched.meta.changes });
  })
  // ------------------------------------------------------------ edit (苔片を直す)
  // Session-only like the timeline: editing starts from reading what you
  // wrote, and a post:write PAT has no business rewriting history (403). The
  // wire shape is the composer's (createPostSchema) — the edit form mirrors
  // it — and the write is wholesale: the body re-encrypted, links replaced.
  .patch("/:id", requireSession, async (c) => {
    const key = await getBodyKey(c.env);
    if (!key) return fail(c, "encryption_not_configured");

    const id = postIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, "validation_error");
    const parsed = createPostSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, "validation_error");
    const wanted = parseTagNames(parsed.data.tags ?? []);
    if (wanted.some((t) => t.norm === "")) return fail(c, "validation_error");

    const userId = c.get("userId");
    const db = createDb(c.env.DB);

    // Not yours and nonexistent answer the same 404 — no existence oracle
    // (tokens の流儀).
    const owned = (
      await db
        .select({
          id: post.id,
          bodyFormat: post.bodyFormat,
          firstDay: post.firstDay,
          lastDay: post.lastDay,
          thickness: post.thickness,
          createdAt: post.createdAt,
        })
        .from(post)
        .where(and(eq(post.id, id.data), eq(post.userId, userId)))
        .limit(1)
    )[0];
    if (!owned) return fail(c, "not_found");

    const now = Date.now();
    // The days and the 厚み (patchStacking): what the body leaves out keeps the
    // row's own, so an edit that says nothing about them moves nothing, and
    // the 厚み is three-valued (absent = keep, null = none, a number = replace).
    // Whatever results is read by the same rule as a new 苔片 — this is where
    // a 続く苔片 is lengthened, its 厚み riding along, and it may not be
    // lengthened past today; shortening one to a day while its 厚み stays, or
    // lengthening a day without saying its 厚み, is the same 400 (ADR-0007).
    const today = dayKey(now);
    const stacking = patchStacking(decodeStacking(owned), parsed.data, today);
    if (stacking === null) return fail(c, "validation_error");
    const days = encodeStacking(stacking);
    const { newTags, resolved } = await resolveTagRows(db, userId, wanted, now);

    // Encrypt at the last moment, like create — plaintext never rides an error.
    const encryptedBody = await encryptBody(parsed.data.body, key);
    const kind = parsed.data.kind ?? null;

    // One atomic batch: the row, any new stones, then the links replaced
    // wholesale — old links deleted BEFORE the inserts so a kept tag can't
    // collide with the (post_id, tag_id) PK, and new tags inserted before any
    // link that references them (FK).
    await db.batch([
      db
        .update(post)
        .set({ body: encryptedBody, ...days, kind, updatedAt: now })
        .where(eq(post.id, owned.id)),
      ...newTags.map((t) => db.insert(tag).values(t)),
      db.delete(postTags).where(eq(postTags.postId, owned.id)),
      ...resolved.map((t) => db.insert(postTags).values({ postId: owned.id, tagId: t.id })),
    ]);

    const item: PostItem = {
      id: owned.id,
      body: parsed.data.body,
      bodyFormat: owned.bodyFormat,
      createdAt: owned.createdAt,
      updatedAt: now,
      ...days,
      // The day it was written on never moves — an edit is not a new 苔片.
      postedDay: dayKey(owned.createdAt),
      kind,
      tags: resolved,
    };
    return c.json(item);
  })
  // ---------------------------------------------------------- delete (苔片を除く)
  // Physical (ADR-0003): one DELETE, and the post_tags links go with it via
  // ON DELETE CASCADE — D1 always enforces FKs. No BODY_KEY gate: nothing
  // here reads or writes a plaintext. Session-only, same 404 discipline.
  .delete("/:id", requireSession, async (c) => {
    const id = postIdSchema.safeParse(c.req.param("id"));
    if (!id.success) return fail(c, "validation_error");

    const db = createDb(c.env.DB);
    const owned = (
      await db
        .select({ id: post.id })
        .from(post)
        .where(and(eq(post.id, id.data), eq(post.userId, c.get("userId"))))
        .limit(1)
    )[0];
    if (!owned) return fail(c, "not_found");

    await db.delete(post).where(eq(post.id, owned.id));
    return c.json({});
  });
