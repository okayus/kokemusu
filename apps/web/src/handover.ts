// 渡す (CONTEXT.md, ADR-0009): a 送り側 hands a 苔片 not yet stacked to the 積む
// dialog through a link — `/積む#post=<JSON>`, the JSON a POST /api/posts body
// (docs/senders.md「リンクで渡す」). The browser keeps everything after `#` to
// itself: the Worker sees `GET /積む` and nothing more, so the body is read
// here, and nothing is posted until the owner presses 積む.
//
// What a link hands over is held to the API's own rules (2026-11-24 grill ①):
// a body POST /api/posts would answer 400 opens nothing, and the reason is
// shown — the same contract through a second door, and a door that quietly
// dropped a key would hide the drift ADR-0008 exists to catch. Two rules are
// the dialog's instead, because they need today and only the server's today
// counts: the ceiling (no day after today) and the floor (1200 months back) —
// the date fields carry both as max / min, so 積む stops there. One rule is
// stricter than the API's: `lastDay` without `firstDay` is refused, since its
// meaning (today 〜 lastDay) needs today too, and the dialog would read the
// pair as that single day. The SPA must not import Worker modules, so the
// rules are spelled once more here; worker/senders-contract.test.ts holds them
// to createPostSchema and parseStacking, body by body.

import { EVERY_DAY } from "./days";
import { EMPTY_DRAFT, MAX_ASIDE, receiveHanded, type Draft, type Drafts } from "./draft";
import { parseKind, POST_KINDS } from "./kind";
import { addStones, MAX_TAGS, normalizeTagName } from "./tags";
import { pathKey } from "./view";

/** The path a link opens: the 積む dialog's own entry — with nothing handed, the 書きかけ as it is. */
export const COMPOSE_PATH = "/積む";

/** Whether a pathname, as the browser hands it, is the 積む entry. */
export const isComposePath = (pathname: string): boolean => pathKey(pathname) === COMPOSE_PATH;

/** What a link hands over: the 書きかけ it becomes, or why it opens nothing. */
export type Handover = { ok: true; draft: Draft } | { ok: false; reason: string };

const refuse = (reason: string): Handover => ({ ok: false, reason });

/** The keys of a POST /api/posts body — createPostSchema's, which is strict. */
const POST_KEYS: readonly string[] = ["body", "tags", "kind", "firstDay", "lastDay", "thickness"];

/** createPostSchema's caps (worker/routes/posts.ts), counted in UTF-16 units as zod counts them. */
const MAX_BODY_CHARS = 20_000;
const MAX_TAG_CHARS = 100;

/** A `YYYY-MM-DD` the calendar has — worker/core/day.ts isDayKey, by the same rollover test. */
export function isCalendarDay(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const year = +raw.slice(0, 4);
  const month = +raw.slice(5, 7);
  const day = +raw.slice(8, 10);
  // setUTCFullYear, not Date.UTC: the latter maps years 0–99 into the 1900s.
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * The fragment of a link to /積む → what it hands over, or null when it hands
 * nothing (an empty fragment: the dialog opens on the 書きかけ as it is). The
 * fragment carries one `post` and nothing else — another key, or a second
 * `post`, is refused like an unknown key in the body.
 */
export function readHandover(hash: string): Handover | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const keys = [...new Set(params.keys())];
  if (keys.length === 0) return null;
  const others = keys.filter((key) => key !== "post");
  if (others.length > 0) return refuse(`# の中の知らない項目 ${others.join("・")}`);
  const posts = params.getAll("post");
  if (posts.length > 1) return refuse("# の中に post が 2 つあります");
  return readHandedPost(posts[0] ?? "");
}

/** The `post` JSON → what it hands over (the header says which rules are whose). */
export function readHandedPost(text: string): Handover {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("post が JSON として読めません");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return refuse("post が JSON のオブジェクトではありません");
  }
  const post = parsed as Record<string, unknown>;
  const unknown = Object.keys(post).filter((key) => !POST_KEYS.includes(key));
  if (unknown.length > 0) return refuse(`知らない項目 ${unknown.join("・")}`);
  const { body, tags, kind, firstDay, lastDay, thickness } = post;

  if (body === undefined) return refuse("本文（body）がありません");
  if (typeof body !== "string") return refuse("本文（body）が文字列ではありません");
  if (body.trim() === "") return refuse("本文（body）が空です");
  if (body.length > MAX_BODY_CHARS) return refuse("本文（body）が 20,000 字を超えています");

  let stones: string[] = [];
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return refuse("石（tags）が配列ではありません");
    if (tags.length > MAX_TAGS) return refuse(`石（tags）が ${MAX_TAGS} 個を超えています`);
    const names: string[] = [];
    for (const tag of tags as unknown[]) {
      if (typeof tag !== "string") return refuse("石（tags）に文字列でないものがあります");
      if (tag.length > MAX_TAG_CHARS) return refuse(`石（tags）に ${MAX_TAG_CHARS} 字を超える名前があります`);
      // The route refuses a name that folds to nothing (trim ＋ NFKC ＋ 小文字), not only "".
      if (normalizeTagName(tag) === "") return refuse("石（tags）に空の名前があります");
      names.push(tag);
    }
    // Deduped by norm, first spelling first — what the route does on 積む.
    stones = addStones([], names);
  }

  if (kind !== undefined && kind !== null && !(POST_KINDS as readonly unknown[]).includes(kind)) {
    return refuse("向き（kind）が input・output・both・null のどれでもありません");
  }

  if (firstDay !== undefined && (typeof firstDay !== "string" || !isCalendarDay(firstDay))) {
    return refuse("firstDay が YYYY-MM-DD の暦日ではありません");
  }
  if (lastDay !== undefined && (typeof lastDay !== "string" || !isCalendarDay(lastDay))) {
    return refuse("lastDay が YYYY-MM-DD の暦日ではありません");
  }
  if (
    thickness !== undefined &&
    thickness !== null &&
    !(typeof thickness === "number" && Number.isInteger(thickness) && thickness >= 1 && thickness <= 100)
  ) {
    return refuse("厚み（thickness）が 1〜100 の整数ではありません");
  }

  // The days, today-free (core/stacking.ts parseStacking without its today).
  const first = typeof firstDay === "string" ? firstDay : null;
  const last = typeof lastDay === "string" ? lastDay : null;
  if (first === null && last !== null) return refuse("lastDay だけでは渡せません（firstDay も入れてください）");
  if (first !== null && last !== null && first > last) return refuse("firstDay が lastDay より後です");
  const range = first !== null && last !== null && first < last;
  const declared = typeof thickness === "number" ? thickness : null;
  if (range && declared === null) return refuse("範囲（firstDay < lastDay）には厚み（thickness）が要ります");
  if (!range && declared !== null) return refuse("1 日だけの苔片に厚み（thickness）は付けられません");

  return {
    ok: true,
    draft: {
      ...EMPTY_DRAFT,
      body,
      tags: stones,
      kind: parseKind(kind),
      firstDay: first ?? "",
      lastDay: last ?? "",
      // A single day shows no slider; 毎日 is where the slider starts if it ever does.
      thickness: declared ?? EVERY_DAY,
      handed: true,
    },
  };
}

/**
 * What arriving at a URL means for the 積む dialog: null when it is not the
 * entry; open the dialog — on `drafts` when a link handed something over
 * (draft.ts receiveHanded), on the 書きかけ as it is when `drafts` is null; or
 * open nothing, with the sentence that says why. Pure: the caller reads the
 * location and the storage, and writes both back.
 */
export type Arrival = { open: true; drafts: Drafts | null } | { open: false; problem: string };

export function arrivalAt(pathname: string, hash: string, drafts: Drafts): Arrival | null {
  if (!isComposePath(pathname)) return null;
  const handover = readHandover(hash);
  if (handover === null) return { open: true, drafts: null };
  if (!handover.ok) {
    return { open: false, problem: `リンクで渡された苔片を開けませんでした: ${handover.reason}` };
  }
  const received = receiveHanded(drafts, handover.draft);
  if (received === null) {
    return {
      open: false,
      problem:
        `脇に置いた書きかけが ${MAX_ASIDE} 件あるので、リンクで渡された苔片は開きませんでした。` +
        "いまの書きかけを積むか捨ててから、もう一度リンクを開いてください。",
    };
  }
  return { open: true, drafts: received };
}
