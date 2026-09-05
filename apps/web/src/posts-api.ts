// Browser side of the 苔片 API: create + edit + delete + timeline + tag
// suggestions. Bodies travel plaintext over the same-origin HTTPS request; the
// Worker encrypts right before D1 (ADR-0001). Delete is physical (ADR-0003).
import { postJson, request } from "./api";

export type TagSummary = { id: string; name: string };

/** 向き (CONTEXT.md): インプット / アウトプット / 両方. Absent on the 苔片 = 未分類 (null). */
export type PostKind = "input" | "output" | "both";

export type PostItem = {
  id: string;
  title: string | null;
  body: string;
  bodyFormat: string;
  createdAt: number;
  updatedAt: number;
  /** First and last JST 「日」 this 苔片 was there (`YYYY-MM-DD`, ADR-0005) — server-decided; equal for a single day. */
  firstDay: string;
  lastDay: string;
  /** The JST day it was written on. 「いま積んだ」 = all three days equal — the client only compares. */
  postedDay: string;
  kind: PostKind | null;
  tags: TagSummary[];
};

/** `today` is server-decided (JST) like the 年表's axis edge — the anchor of the period presets. */
export type Timeline = { posts: PostItem[]; nextCursor: string | null; today: string };

// `title` = the optional 見出し (roadmap 決めること 7); omitted = none.
export const createPost = (input: {
  body: string;
  tags?: string[];
  title?: string;
}): Promise<PostItem> => postJson("/api/posts", input);

// Wholesale replacement of the editable fields — the edit form always sends
// the complete new state, so an omitted/blank title clears the heading and
// the tags array replaces the links.
export const updatePost = (
  id: string,
  input: { body: string; title?: string; tags?: string[] },
): Promise<PostItem> =>
  request(`/api/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const deletePost = (id: string): Promise<Record<string, never>> =>
  request(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" });

// `tag` = one tag by name, `tags` = a 2+ tag AND set by id (same wire 規約 as
// the 年表's deep-dive rows) — the server rejects a request carrying both.
// `from` / `to` = inclusive JST days (`YYYY-MM-DD`, the 総草's window form),
// either half alone allowed; the server rejects an inverted pair.
export function listPosts(
  opts: {
    cursor?: string;
    tag?: string;
    tags?: string[];
    from?: string;
    to?: string;
    limit?: number;
  } = {},
): Promise<Timeline> {
  const q = new URLSearchParams();
  if (opts.cursor !== undefined) q.set("cursor", opts.cursor);
  if (opts.tag !== undefined) q.set("tag", opts.tag);
  if (opts.tags !== undefined) q.set("tags", opts.tags.join(","));
  if (opts.from !== undefined) q.set("from", opts.from);
  if (opts.to !== undefined) q.set("to", opts.to);
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request(`/api/posts${qs ? `?${qs}` : ""}`);
}

export const listTags = (): Promise<TagSummary[]> => request("/api/tags");

/**
 * Split the composer's one tag field on half/full-width commas and 読点 —
 * friendly to Japanese IME input. The server re-normalizes; this only decides
 * where one tag ends and the next begins.
 */
export function splitTagField(raw: string): string[] {
  return raw
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
