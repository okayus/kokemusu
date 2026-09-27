// Browser side of the 苔片 API: create + edit + delete + timeline + tag
// suggestions. Bodies travel plaintext over the same-origin HTTPS request; the
// Worker encrypts right before D1 (ADR-0001). Delete is physical (ADR-0003).
import { postJson, request } from "./api";
import type { PostKind } from "./kind";

export type TagSummary = { id: string; name: string };

export type PostItem = {
  id: string;
  body: string;
  bodyFormat: string;
  createdAt: number;
  updatedAt: number;
  /** First and last JST 「日」 this 苔片 was there (`YYYY-MM-DD`, ADR-0005) — server-decided; equal for a single day. */
  firstDay: string;
  lastDay: string;
  /** 厚み of a 続く苔片, a whole 1..100 (ADR-0007); null ⇔ a single day (`firstDay === lastDay`). */
  thickness: number | null;
  /** The JST day it was written on. 「いま積んだ」 = all three days equal — the client only compares. */
  postedDay: string;
  /** 向き (kind.ts); null = 未分類. */
  kind: PostKind | null;
  tags: TagSummary[];
};

/** `today` is server-decided (JST) like the 年表's axis edge — the anchor of the period presets. */
export type Timeline = { posts: PostItem[]; nextCursor: string | null; today: string };

/**
 * What a write carries: the body, and the optional stones / 向き / days — and
 * nothing else: the server refuses a key it does not name (ADR-0006).
 */
export type PostInput = {
  body: string;
  tags?: string[];
  // 向き — omitted or null = 未分類.
  kind?: PostKind | null;
  // The days to stack on (`YYYY-MM-DD`, ADR-0005): a past day, or a range that
  // makes a 続く苔片. Omitted on 積む = today; omitted on 直す = the row's own.
  // The server holds them to first ≤ last ≤ today (400 otherwise).
  firstDay?: string;
  lastDay?: string;
  // 厚み (ADR-0007), read with the days: a range must carry one (a whole
  // 1..100) and a single day must not (null or omitted). On 直す, omitted = the
  // row's own, null = none — sent with the days that make it a single day.
  // Anything else is a 400, never a silent default.
  thickness?: number | null;
};

export const createPost = (input: PostInput): Promise<PostItem> => postJson("/api/posts", input);

// Wholesale replacement of the editable fields — the edit form always sends
// the complete new state, so the tags array replaces the links and an omitted
// 向き clears it.
export const updatePost = (id: string, input: PostInput): Promise<PostItem> =>
  request(`/api/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deletePost = (id: string): Promise<Record<string, never>> =>
  request(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

/**
 * The feed's filter in wire form — what the timeline, its count and 付け替え
 * share, so what is shown narrowed is what is counted and retagged. `tag` =
 * one tag by name, `tags` = a 2+ tag AND set by id (same wire 規約 as the
 * 年表's deep-dive rows) — the server rejects a request carrying both. `from` /
 * `to` = inclusive JST days (`YYYY-MM-DD`, the 総草's window form), either
 * half alone allowed; the server rejects an inverted pair.
 */
export type FeedFilter = { tag?: string; tags?: string[]; from?: string; to?: string };

function filterParams(filter: FeedFilter): URLSearchParams {
  const q = new URLSearchParams();
  if (filter.tag !== undefined) q.set("tag", filter.tag);
  if (filter.tags !== undefined) q.set("tags", filter.tags.join(","));
  if (filter.from !== undefined) q.set("from", filter.from);
  if (filter.to !== undefined) q.set("to", filter.to);
  return q;
}

export function listPosts(
  opts: FeedFilter & { cursor?: string; limit?: number } = {},
): Promise<Timeline> {
  const q = filterParams(opts);
  if (opts.cursor !== undefined) q.set("cursor", opts.cursor);
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request(`/api/posts${qs ? `?${qs}` : ""}`);
}

/** How many 苔片 the filter holds — loaded pages or not. */
export const countPosts = (filter: FeedFilter): Promise<{ count: number }> =>
  request(`/api/posts/count?${filterParams(filter)}`);

/** What a 付け替え reports: the 苔片 the filter held, and how many actually changed. */
export type RetagResult = { matched: number; changed: number };

/**
 * 付け替え (features.md §2): every 苔片 of the filter gains the stones in `add`
 * (by name — a new spelling mints a stone, as on 積む) and loses those in
 * `remove` (by id), atomically. The server insists on a stone in the filter
 * and refuses a stone on both sides (400).
 */
export const retagPosts = (
  filter: FeedFilter,
  change: { add: string[]; remove: string[] },
): Promise<RetagResult> =>
  request(`/api/posts?${filterParams(filter)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });

export const listTags = (): Promise<TagSummary[]> => request("/api/tags");
