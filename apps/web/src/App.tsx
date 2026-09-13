import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { describeApiError, isApiError } from "./api";
import {
  addDevice,
  describeAuthError,
  listCredentials,
  removeCredential,
  supportsPasskeys,
  type AuthUser,
  type CredentialSummary,
} from "./auth-api";
import {
  BodyField,
  ComposeDialog,
  DaysDisclosure,
  KindField,
  seedOf,
  stoneNames,
  useComposeShortcut,
  type ComposeRequest,
} from "./Compose";
import {
  EVERY_DAY,
  isStackedNow,
  placeInFeed,
  postedLabel,
  stackingInput,
  thicknessLabel,
  type DaysFields,
} from "./days";
import { clearDraft } from "./draft";
import { HeatmapSection } from "./Heatmap";
import { KIND_LABELS, parseKind, type PostKind } from "./kind";
import { Markdown } from "./markdown";
import {
  periodFromFields,
  periodKey,
  periodLabel,
  PRESETS,
  presetPeriod,
  slashDay,
  spanInPeriod,
  type Period,
} from "./period";
import {
  deletePost,
  listPosts,
  listTags,
  updatePost,
  type PostItem,
  type TagSummary,
} from "./posts-api";
import { togglePair, toggleStone } from "./stones";
import { TagField } from "./TagField";
import { TagGraphSection } from "./TagGraph";
import { stonesOf, type TagsFields } from "./tags";
import { rowKey, TagTimelineSection } from "./TagTimeline";
import { pathOf, useView, VIEWS, type View } from "./view";
import {
  createToken,
  listTokens,
  revokeToken,
  type CreatedToken,
  type TokenSummary,
} from "./tokens-api";
import { useAuth } from "./useAuth";

const dateFmt = new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (ms: number | null) => (ms === null ? "—" : dateFmt.format(new Date(ms)));

/**
 * The receipt after a post, hung from the bar: a sentence, and — for a 苔片
 * the feed did not travel to (a past day, a 続く苔片) — the one tap that
 * narrows the feed to its days. Never applied on the reader's behalf
 * (features.md §1).
 */
type Notice = { text: string; action?: { label: string; run: () => void } };

/** What the edit form's date fields mean: the days as they are, lengthened or moved here. */
const EDIT_DAYS_HINT =
  "範囲にすると、その日々に在った続く苔片になり、厚み（そのうち打ち込んでいた日の割合）を添えます。今日より先には伸ばせません。";

export function App() {
  const auth = useAuth();
  if (auth.state.status === "loading") {
    return (
      <main className="shell">
        <p className="quiet">…</p>
      </main>
    );
  }
  if (auth.state.status === "anonymous") {
    return <AnonymousView onLogin={auth.login} onRegister={auth.register} />;
  }
  return (
    <AuthedView user={auth.state.user} onLogout={auth.logout} onSessionLost={auth.toAnonymous} />
  );
}

function AnonymousView(props: {
  onLogin: () => Promise<void>;
  onRegister: (input: {
    displayName: string;
    initialRegistrationToken: string;
    deviceName?: string;
  }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeAuthError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="hero">
        <h1>苔むす</h1>
        <p className="quiet">ことばを積んで、苔を育てる。</p>
      </header>

      {!supportsPasskeys() && (
        <p role="alert" className="error">
          このブラウザはパスキーに対応していません。
        </p>
      )}

      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void run(props.onLogin)}
      >
        パスキーでログイン
      </button>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}

      <details className="panel">
        <summary>初回登録（登録トークンが必要）</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const deviceName = String(fd.get("deviceName") ?? "").trim();
            void run(() =>
              props.onRegister({
                displayName: String(fd.get("displayName") ?? "").trim(),
                initialRegistrationToken: String(fd.get("token") ?? ""),
                ...(deviceName ? { deviceName } : {}),
              }),
            );
          }}
        >
          <div className="field">
            <label htmlFor="displayName">表示名</label>
            <input
              id="displayName"
              name="displayName"
              required
              maxLength={64}
              autoComplete="nickname"
            />
          </div>
          <div className="field">
            <label htmlFor="token">登録トークン</label>
            <input
              id="token"
              name="token"
              required
              autoComplete="off"
              aria-describedby="token-hint"
            />
            <p className="hint" id="token-hint">
              `wrangler secret put INITIAL_REGISTRATION_TOKEN` で設定した値。
            </p>
          </div>
          <div className="field">
            <label htmlFor="deviceName">この端末の名前（任意）</label>
            <input
              id="deviceName"
              name="deviceName"
              maxLength={64}
              placeholder="MacBook / iPhone など"
            />
          </div>
          <button type="submit" disabled={busy}>
            パスキーを作って登録
          </button>
        </form>
      </details>
    </main>
  );
}

function AuthedView(props: {
  user: AuthUser;
  onLogout: () => Promise<void>;
  onSessionLost: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // The 積む dialog's request lives here because two places raise it: the `n`
  // key (resume the draft as it is) up here, and — down in Garden — the round
  // 積む at the bottom-right corner (CornerButton) and a 苔片's 同じ石に積む
  // (that 苔片's stones and 向き seeded). Garden renders it.
  const [compose, setCompose] = useState<ComposeRequest | null>(null);
  // The receipt after a post — 「積みました」, and where it went when the feed
  // cannot show it — hangs from the sticky bar so it is in view wherever the
  // reader was. It goes away on its own; nothing else moves. One carrying a
  // button stays longer: a tap target that vanishes mid-reach is a trap.
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), notice.action === undefined ? 6000 : 15000);
    return () => clearTimeout(timer);
  }, [notice]);
  const noticeAction = notice?.action;
  const openCompose = useCallback(() => setCompose({ seed: null }), []);
  useComposeShortcut(openCompose);
  // 見かた (features.md §3): 投稿一覧 or 年表, read from and written to the URL.
  const { view, show } = useView();
  return (
    <main className="shell">
      <header className="bar">
        <h1>苔むす</h1>
        <div className="bar-actions">
          <button
            type="button"
            onClick={() => {
              // A shared machine keeps no half-written 苔片 after logout.
              clearDraft();
              void props.onLogout().catch((e) => setError(describeAuthError(e)));
            }}
          >
            ログアウト
          </button>
        </div>
        {/* The two views as links in the sticky bar — reachable from anywhere
            down a long feed. Real hrefs (a new tab, a bookmark, a middle
            click all work); a plain click is taken over so the view swaps in
            place and the page starts from the top, like a page would. */}
        <nav className="views" aria-label="見かた">
          {VIEWS.map((v) => (
            <a
              key={v.view}
              href={pathOf(v.view)}
              aria-current={view === v.view ? "page" : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                show(v.view);
                // A view swap is a page change, not a 導線's travel: jump, do
                // not glide (the CSS smooth scroll is for in-page landings).
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
            >
              {v.label}
            </a>
          ))}
        </nav>
        {/* Always in the tree: a live region must exist before its text lands. */}
        <p role="status" className={notice === null ? "bar-notice" : "bar-notice on"}>
          {notice?.text ?? ""}
          {noticeAction !== undefined && (
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                noticeAction.run();
              }}
            >
              {noticeAction.label}
            </button>
          )}
        </p>
      </header>
      <p className="quiet">{props.user.displayName} の庭。</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Garden
        view={view}
        onView={show}
        onSessionLost={props.onSessionLost}
        compose={compose}
        onCompose={setCompose}
        onComposeClose={() => setCompose(null)}
        onNotice={setNotice}
      />
      <details className="panel">
        <summary>パスキー（端末）</summary>
        <DevicesSection />
      </details>
      <details className="panel">
        <summary>API トークン（PAT）</summary>
        <TokensSection />
      </details>
    </main>
  );
}

/**
 * The round button fixed to the bottom-right corner (features.md §1) — one tap
 * from wherever the reader has scrolled to, under the thumb on a phone. It is
 * 積む, except while a 苔片 is being edited in the feed on screen: then it is
 * that form's 保存 in the same place, because a reader mid-edit has nothing to
 * 積む and everything to save (2026-09-13). The 保存 is the edit form's own
 * submit button, joined by the `form` attribute, so the form's validation and
 * onSubmit run as if it sat inside — the form keeps its own 保存 too, the
 * keyboard's way, right after the last field. Icon-only, so the name is on the
 * button itself; styles.css hides it while a dialog is up.
 */
function CornerButton(props: { saveFormId: string | null; onCompose: () => void }) {
  if (props.saveFormId !== null) {
    return (
      <button type="submit" form={props.saveFormId} className="fab" aria-label="保存" title="保存">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }
  return (
    <button type="button" className="fab" aria-label="積む" title="積む" onClick={props.onCompose}>
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
        <path
          d="M12 5v14M5 12h14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** The `?tag=`/`?tags=` split (posts-api): one tag goes by name, a set by id. */
function filterQuery(filter: TagSummary[]): { tag?: string; tags?: string[] } {
  const [first] = filter;
  if (first === undefined) return {};
  return filter.length === 1 ? { tag: first.name } : { tags: filter.map((t) => t.id) };
}

/** Everything the feed is narrowed by, in wire form: stones and the period AND together. */
function feedQuery(filter: TagSummary[], period: Period | null) {
  return { ...filterQuery(filter), ...(period ?? {}) };
}

/**
 * The garden: 苔（総草）→ 年表 → 石のつながり → 投稿一覧, top to bottom (features.md
 * §3, 2026-09-05 — the composer left the top for a dialog, so the page is for
 * looking back; the feed grows downward with もっと遡る, so it stays last).
 * Owns the loaded page of 苔片 and renders the 積む dialog when asked.
 */
function Garden(props: {
  /** Which view is up (features.md §3): the 投稿一覧 or the 年表. */
  view: View;
  onView: (view: View) => void;
  onSessionLost: () => void;
  compose: ComposeRequest | null;
  onCompose: (request: ComposeRequest) => void;
  onComposeClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [posts, setPosts] = useState<PostItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tagOptions, setTagOptions] = useState<TagSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped after each post: the moss must darken right away (DoD 4 — the one
  // deliberate motion in the UI, plans/vertical-slice.md の UI トーン決定).
  const [mossVersion, setMossVersion] = useState(0);
  // 選んだ石 (features.md §3, 2026-09-07): the one selection both views read —
  // the 投稿一覧's AND filter and the 年表's axis. The graph's stones and
  // bridges toggle it (stones.ts), a chip on a 苔片 or a 年表 row replaces it
  // with that one stone, the feed's filter chips take one out.
  const [stones, setStones] = useState<TagSummary[]>([]);
  const timelineRef = useRef<HTMLElement | null>(null);
  // 期間の絞り込み (features.md §3): the reader's own 導線 — a preset or a
  // custom range from the 期間で絞る form, or a 総草 cell — and it ANDs with
  // the stones. The 投稿一覧's alone: the 年表 has no period.
  const [postPeriod, setPostPeriod] = useState<Period | null>(null);
  // Server-decided today (JST), refreshed with every first page: the anchor
  // of 今日 / 今週 / 今月 / 今年, so the presets cut where the server cuts.
  const [today, setToday] = useState<string | null>(null);
  const feedRef = useRef<HTMLElement | null>(null);
  // 編集中の苔片 (features.md §1): one at a time, and held here rather than in
  // the card, because the corner button (CornerButton) has to know whose 保存
  // it is — two open forms would leave it nothing to point at. The card seeds
  // its own fields when 編集 is pressed; this is only which one.
  const [editingId, setEditingId] = useState<string | null>(null);

  const { onSessionLost } = props;
  const fault = useCallback(
    (e: unknown) => {
      // Any 401 funnels back to the login screen (useAuth.toAnonymous).
      if (isApiError(e) && e.status === 401) onSessionLost();
      else setError(describeApiError(e));
    },
    [onSessionLost],
  );

  // The filter moved (stones or period): drop the shown page before this
  // render's output so stale 苔片 never sit under the new chips (the
  // adjust-state-while-rendering pattern, same as the 年表's focus). The epoch
  // keeps a slow もっと遡る answer from appending the old filter's page under
  // the new one.
  const filterKey = `${rowKey(stones)}|${periodKey(postPeriod)}`;
  const [shownFilterKey, setShownFilterKey] = useState(filterKey);
  const feedEpoch = useRef(0);
  if (shownFilterKey !== filterKey) {
    setShownFilterKey(filterKey);
    feedEpoch.current += 1;
    setPosts(null);
    setNextCursor(null);
  }
  // A 苔片 that left the page — the filter moved, a fresh page came without it
  // — took its form with it: the corner and the other cards' 編集 must not stay
  // bound to a form that is gone (the same render-phase adjustment).
  if (editingId !== null && !(posts?.some((p) => p.id === editingId) ?? false)) {
    setEditingId(null);
  }

  useEffect(() => {
    listTags().then(setTagOptions).catch(fault);
  }, [fault]);

  useEffect(() => {
    let cancelled = false;
    listPosts(feedQuery(stones, postPeriod))
      .then((timeline) => {
        if (cancelled) return;
        setPosts(timeline.posts);
        setNextCursor(timeline.nextCursor);
        setToday(timeline.today);
      })
      .catch((e) => {
        if (!cancelled) fault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [stones, postPeriod, fault]);

  /** Whether a 苔片 carries every 選んだ石. */
  const carriesStones = (item: PostItem) =>
    stones.every((f) => item.tags.some((t) => t.id === f.id));

  /** Whether a 苔片 belongs on this page of the feed: every filtered stone, and days that overlap the period. */
  const inPage = (item: PostItem) => carriesStones(item) && spanInPeriod(item, postPeriod);

  const handleCreated = (created: PostItem) => {
    setError(null);
    // A 苔片 not carrying every filtered stone, or whose days miss the period
    // (its days are the server's call — a post at 00:01 belongs to the new
    // day even if the chip was set at 23:59), belongs off-screen — the moss
    // still darkens, which is the visible receipt that it landed. One that
    // belongs goes where the server's order puts it (days.ts): the head for a
    // 苔片 stacked now, its own day for one stacked on a past day.
    const shown = inPage(created);
    if (shown) {
      setPosts((current) =>
        current === null ? current : placeInFeed(current, created, nextCursor !== null),
      );
    }
    if (isStackedNow(created)) {
      if (props.view === "posts") {
        // The dialog has closed and focus is back on its invoker — the bar, or
        // a 苔片 somewhere down the feed — so the new 苔片 at the head of the
        // list is usually off-screen: travel there, the 導線's own movement.
        if (shown) feedRef.current?.scrollIntoView({ block: "start" });
        props.onNotice({ text: shown ? "積みました" : "積みました（いまの絞り込みの外）" });
      } else {
        // Stacked from the 年表 view: the feed is not on screen, and the view
        // is never swapped on the reader's behalf (features.md §3) — the
        // receipt offers the way there instead, and the 年表 itself redraws
        // (mossVersion) as the visible receipt of the new 苔片.
        props.onNotice(
          shown
            ? { text: "積みました", action: { label: "投稿一覧へ", run: travelToFeed } }
            : { text: "積みました（いまの絞り込みの外）" },
        );
      }
    } else {
      // A past day or a 続く苔片 is not at the head, so the feed stays put and
      // is never narrowed on the reader's behalf (features.md §1); the receipt
      // offers the narrowing instead — the 苔片's days as the period, with the
      // stones let go when it does not carry them, so the tap always lands on it.
      const days = { from: created.firstDay, to: created.lastDay };
      const withStones = carriesStones(created) ? undefined : [];
      props.onNotice({
        text: "積みました",
        action: { label: `${periodLabel(days)} に絞る`, run: () => showPeriod(days, withStones) },
      });
    }
    setMossVersion((v) => v + 1);
    // The post may have minted new stones — refresh the completion list.
    if (created.tags.length > 0) {
      void listTags()
        .then(setTagOptions)
        .catch(() => {});
    }
  };

  const handleUpdated = (updated: PostItem) => {
    setError(null);
    // Same rule as create: a 苔片 whose new stones or days no longer meet the
    // filter drops out of the filtered view instead of lingering stale. Days
    // that moved move its seat in the order too (re-placed like a new 苔片);
    // unchanged days keep it where it is, whatever page boundary it sits on.
    const keep = inPage(updated);
    setPosts((current) => {
      if (current === null) return current;
      if (!keep) return current.filter((p) => p.id !== updated.id);
      const before = current.find((p) => p.id === updated.id);
      if (before !== undefined && before.firstDay === updated.firstDay) {
        return current.map((p) => (p.id === updated.id ? updated : p));
      }
      return placeInFeed(
        current.filter((p) => p.id !== updated.id),
        updated,
        nextCursor !== null,
      );
    });
    // Tags may have moved between stones, days along the axis — the 総草, the
    // 年表 and つながり follow.
    setMossVersion((v) => v + 1);
    if (updated.tags.length > 0) {
      void listTags()
        .then(setTagOptions)
        .catch(() => {});
    }
  };

  const handleDeleted = (id: string) => {
    setError(null);
    setPosts((current) => (current === null ? current : current.filter((p) => p.id !== id)));
    // The moss lightens — the visible receipt that the 苔片 is gone (ADR-0003).
    setMossVersion((v) => v + 1);
  };

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    const epoch = feedEpoch.current;
    setLoadingMore(true);
    try {
      const timeline = await listPosts({
        cursor: nextCursor,
        ...feedQuery(stones, postPeriod),
      });
      if (epoch === feedEpoch.current) {
        setPosts((current) => [...(current ?? []), ...timeline.posts]);
        setNextCursor(timeline.nextCursor);
      }
    } catch (e) {
      if (epoch === feedEpoch.current) fault(e);
    } finally {
      setLoadingMore(false);
    }
  };

  // The same stones in a new array keep the identity so nothing refetches.
  const replaceStones = (tags: TagSummary[]) =>
    setStones((current) => (rowKey(current) === rowKey(tags) ? current : tags));

  // 導線の着地 in the 投稿一覧: bring that view up if the 年表 was, then travel
  // to the feed's head (scroll-behavior in CSS honours reduced motion). The
  // swap is flushed first — a hidden section cannot be scrolled to.
  const travelToFeed = () => {
    if (props.view !== "posts") flushSync(() => props.onView("posts"));
    feedRef.current?.scrollIntoView({ block: "start" });
  };

  // A chip's 導線: these stones, then travel — the intent is "show me those
  // 苔片", so a same-set tap still travels.
  const showPosts = (tags: TagSummary[]) => {
    replaceStones(tags);
    travelToFeed();
  };

  // The period's twin, for the days of a 苔片 or the 総草's one day: the same
  // window the 期間で絞る form makes, so the chip reads the days and the fields
  // show them. The stones stay unless `withStones` says otherwise: the cell
  // counts every 苔片 of the day, but a reader who narrowed to a stone asked
  // for that stone's, and the chips say both.
  const showPeriod = (period: { from: string; to: string }, withStones?: TagSummary[]) => {
    if (withStones !== undefined) replaceStones(withStones);
    setPostPeriod((current) => (periodKey(current) === periodKey(period) ? current : period));
    travelToFeed();
  };

  // The 総草's cell lands on that one day (visualization.md §1) — the same
  // 1-day window the 今日 preset makes, so the chip reads 「YYYY/MM/DD ×」.
  const showDay = (day: string) => showPeriod({ from: day, to: day });

  // Chips and the live announcement share one wording: stones by name, the
  // period as its chip text (a whole month reads as the month).
  const narrowedBy = [
    ...stones.map((t) => `「${t.name}」`),
    ...(postPeriod === null ? [] : [periodLabel(postPeriod)]),
  ];
  const showingPosts = props.view === "posts";

  return (
    <>
      {props.compose !== null && (
        <ComposeDialog
          seed={props.compose.seed}
          tagOptions={tagOptions}
          today={today}
          onCreated={handleCreated}
          onClose={props.onComposeClose}
          onSessionLost={props.onSessionLost}
        />
      )}
      {/* 保存 only while the edit form is on screen: in the 年表 view the feed
          is hidden, form and all, and the corner is 積む again. */}
      <CornerButton
        saveFormId={editingId !== null && showingPosts ? editFormId(editingId) : null}
        onCompose={() => props.onCompose({ seed: null })}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* One order serves both views (features.md §3): 総草 (投稿一覧 only) →
          石のつながり (both — the 操作盤, one instance, so its period and its
          answer survive a swap) → 年表 or 投稿一覧. The other view's sections
          stay mounted, hidden, so nothing they hold is lost. */}
      <HeatmapSection
        refreshKey={mossVersion}
        onDayTap={showDay}
        onFault={fault}
        hidden={!showingPosts}
      />
      <TagGraphSection
        refreshKey={mossVersion}
        selected={stones}
        // No travel after a toggle: the answer — the filtered feed or the
        // 内訳 — lands right under the map, and the next tap wants the map still
        // in reach. The feed's live region says what the filter became.
        onStoneTap={(t) => setStones((current) => toggleStone(current, t))}
        onBridgeTap={(a, b) => setStones((current) => togglePair(current, a, b))}
        onFault={fault}
      />
      <TagTimelineSection
        ref={timelineRef}
        refreshKey={mossVersion}
        tagOptions={tagOptions}
        focus={stones}
        onFocusChange={replaceStones}
        onShowPosts={travelToFeed}
        onFault={fault}
        hidden={showingPosts}
      />
      <section className="post-feed" ref={feedRef} hidden={!showingPosts}>
        <h2>投稿一覧</h2>
        {/* The one polite live seat of the feed. Rendered before any filter
            exists — a region must already be in the tree when its text lands. */}
        <p className="visually-hidden" role="status">
          {narrowedBy.length > 0 ? `${narrowedBy.join("と")}で絞り込み中` : ""}
        </p>
        {narrowedBy.length > 0 && (
          <div className="feed-filter">
            <span className="feed-filter-label">絞り込み:</span>
            {stones.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tag-chip"
                aria-label={`「${t.name}」の絞り込みを外す`}
                onClick={() => setStones((current) => current.filter((x) => x.id !== t.id))}
              >
                {t.name} ×
              </button>
            ))}
            {postPeriod !== null && (
              <button
                type="button"
                className="tag-chip period-chip"
                aria-label="期間の絞り込みを外す"
                onClick={() => setPostPeriod(null)}
              >
                {periodLabel(postPeriod)} ×
              </button>
            )}
            <button
              type="button"
              className="feed-filter-clear"
              onClick={() => {
                setStones([]);
                setPostPeriod(null);
              }}
            >
              解除
            </button>
          </div>
        )}
        {/* Closed is the everyday face of the feed; the form only unfolds on
            request. Keyed on the period so an applied range shows in the
            fields and a removed chip empties them. */}
        <details className="feed-period">
          <summary>期間で絞る</summary>
          <PeriodForm
            key={periodKey(postPeriod)}
            period={postPeriod}
            today={today}
            onChange={setPostPeriod}
          />
        </details>
        <Timeline
          posts={posts}
          today={today}
          tagOptions={tagOptions}
          filtered={narrowedBy.length > 0}
          onTagTap={(t) => showPosts([t])}
          onSameStones={(post) => props.onCompose({ seed: seedOf(post) })}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onSessionLost={props.onSessionLost}
          editingId={editingId}
          onEditStart={setEditingId}
          onEditEnd={() => setEditingId(null)}
        />
        {nextCursor !== null && (
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            もっと遡る
          </button>
        )}
      </section>
    </>
  );
}

/**
 * 期間で絞る (features.md §3): 日・週・月・年 as one-tap presets over the server's
 * today, and a custom range on two native date fields. `min` / `max` are
 * cross-set, so an inverted range is the browser's own rangeUnderflow /
 * rangeOverflow — the form never submits it and no request is made; the
 * server's check is the security half. Either field may stay empty (それ以降
 * / それ以前); both empty = no period, which reads as 解除.
 */
function PeriodForm(props: {
  period: Period | null;
  today: string | null;
  onChange: (next: Period | null) => void;
}) {
  // Controlled only so each field can bound the other; the values are the
  // fields' own `YYYY-MM-DD` — never parsed into a Date on this side.
  const [from, setFrom] = useState(props.period?.from ?? "");
  const [to, setTo] = useState(props.period?.to ?? "");
  const { today } = props;
  return (
    <form
      className="feed-period-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onChange(periodFromFields(from, to));
      }}
    >
      <fieldset className="feed-period-presets">
        <legend className="visually-hidden">よく使う期間</legend>
        {PRESETS.map((p) => (
          <button
            key={p.kind}
            type="button"
            disabled={today === null}
            onClick={() => {
              if (today !== null) props.onChange(presetPeriod(p.kind, today));
            }}
          >
            {p.label}
          </button>
        ))}
      </fieldset>
      <fieldset className="feed-period-range">
        <legend className="visually-hidden">カスタム範囲</legend>
        <div className="feed-period-field">
          <label htmlFor="period-from">開始日</label>
          <input
            type="date"
            id="period-from"
            name="from"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="feed-period-field">
          <label htmlFor="period-to">終了日</label>
          <input
            type="date"
            id="period-to"
            name="to"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button type="submit">絞る</button>
      </fieldset>
      <p className="hint">片方だけでも絞れます（開始日だけ = それ以降、終了日だけ = それ以前）。</p>
    </form>
  );
}

function Timeline(props: {
  posts: PostItem[] | null;
  /** The feed's server-decided today — the ceiling of the edit forms' date fields. */
  today: string | null;
  /** The garden's registered stones — the edit forms' tag suggestions. */
  tagOptions: TagSummary[];
  filtered: boolean;
  onTagTap: (tag: TagSummary) => void;
  onSameStones: (post: PostItem) => void;
  onUpdated: (updated: PostItem) => void;
  onDeleted: (id: string) => void;
  onSessionLost: () => void;
  /** The 苔片 being edited, if any — the garden's (one at a time). */
  editingId: string | null;
  onEditStart: (id: string) => void;
  onEditEnd: () => void;
}) {
  if (props.posts === null) {
    return <p className="quiet">…</p>;
  }
  if (props.posts.length === 0) {
    return props.filtered ? (
      <p className="quiet">この絞り込みに合う苔片はありません。</p>
    ) : (
      <p className="quiet">まだ苔片がありません。ひとつ積むと、ここから苔むしていきます。</p>
    );
  }
  return (
    // role="list": list-style is stripped, Safari drops list semantics without
    // it (same note as .tl-rows).
    <ol className="posts" role="list">
      {props.posts.map((p) => (
        <PostEntry
          key={p.id}
          post={p}
          today={props.today}
          tagOptions={props.tagOptions}
          onTagTap={props.onTagTap}
          onSameStones={props.onSameStones}
          onUpdated={props.onUpdated}
          onDeleted={props.onDeleted}
          onSessionLost={props.onSessionLost}
          editingId={props.editingId}
          onEditStart={props.onEditStart}
          onEditEnd={props.onEditEnd}
        />
      ))}
    </ol>
  );
}

/** The edit form's date fields and slider from the 苔片: its days, and its 厚み — 毎日 for a single day, which has none. */
const daysFieldsOf = (p: PostItem): DaysFields => ({
  firstDay: p.firstDay,
  lastDay: p.lastDay,
  thickness: p.thickness ?? EVERY_DAY,
});

/** The edit form's id — what the corner 保存 (CornerButton) names in its `form` attribute. */
const editFormId = (postId: string) => `edit-form-${postId}`;

/**
 * One 苔片: the read view with 編集/削除, or the inline edit form (the
 * composer's mirror — the same fields, uncontrolled so やめる simply
 * discards). Which 苔片 is being edited is the garden's (one at a time): this
 * card is either the one, or one whose 編集 waits until that form is closed.
 * Delete confirms through a native <dialog> showing what dies; the deletion
 * is physical and unrecoverable from the UI (ADR-0003).
 */
function PostEntry(props: {
  post: PostItem;
  today: string | null;
  tagOptions: TagSummary[];
  onTagTap: (tag: TagSummary) => void;
  onSameStones: (post: PostItem) => void;
  onUpdated: (updated: PostItem) => void;
  onDeleted: (id: string) => void;
  onSessionLost: () => void;
  editingId: string | null;
  onEditStart: (id: string) => void;
  onEditEnd: () => void;
}) {
  const p = props.post;
  const editing = props.editingId === p.id;
  const editLocked = props.editingId !== null && !editing;
  // 編集中の本文・日・タグは state（本文はプレビューが要り、日は 2 欄が互いを縛り、
  // タグはチップと候補を持つ）。向きだけ form のまま。「編集」を押した時点の値で
  // 毎回蒔き直すので、やめる ＝ 捨てる が保たれる。厚みのスライダーは苔片の
  // 厚みから、単日（厚み無し）を範囲に伸ばすときは 毎日 から始まる。
  const [editBody, setEditBody] = useState(p.body);
  const [editDays, setEditDays] = useState<DaysFields>(() => daysFieldsOf(p));
  const [editTags, setEditTags] = useState<TagsFields>({ tags: stoneNames(p.tags), text: "" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement | null>(null);

  // The confirm dialog is mounted only while confirming — a permanently
  // mounted (closed) one would keep a hidden copy of the 苔片's text in the
  // DOM. showModal is imperative on purpose: the `open` attribute would show
  // it non-modal, without backdrop or focus trap.
  useEffect(() => {
    if (confirming) confirmRef.current?.showModal();
  }, [confirming]);

  const fault = (e: unknown) => {
    if (isApiError(e) && e.status === 401) props.onSessionLost();
    else setError(describeApiError(e));
  };

  const save = async (input: {
    body: string;
    tags: string[];
    kind: PostKind | null;
    days: DaysFields;
  }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Blank date fields name no days, and a PATCH naming none keeps the
      // row's own — the days only move when the form says where to. The 厚み
      // rides with them: the slider's for a range, none for a single day.
      const updated = await updatePost(p.id, {
        body: input.body,
        tags: input.tags,
        kind: input.kind,
        ...stackingInput(input.days),
      });
      props.onEditEnd();
      props.onUpdated(updated);
    } catch (e) {
      fault(e);
    } finally {
      setBusy(false);
    }
  };

  const destroy = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deletePost(p.id);
      props.onDeleted(p.id);
      // Success unmounts this entry via onDeleted — nothing left to un-busy.
    } catch (e) {
      fault(e);
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <li className="post">
        <form
          id={editFormId(p.id)}
          className="post-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void save({
              body: editBody,
              // The text still typed in the tag field is a stone too (stonesOf).
              tags: stonesOf(editTags),
              kind: parseKind(fd.get("kind")),
              days: editDays,
            });
          }}
        >
          {/* The 苔片's days, folded — the summary names them; opening is how a
              続く苔片 is lengthened (CONTEXT.md: まだ続くものは後で伸ばす). */}
          <DaysDisclosure
            idPrefix={`edit-${p.id}`}
            firstDay={editDays.firstDay}
            lastDay={editDays.lastDay}
            thickness={editDays.thickness}
            today={props.today}
            hint={EDIT_DAYS_HINT}
            onChange={setEditDays}
          />
          <BodyField
            id={`edit-body-${p.id}`}
            label="本文"
            value={editBody}
            onChange={setEditBody}
          />
          {/* Uncontrolled like the other fields: the radio group is re-seeded
              from the 苔片 each time 編集 opens, so やめる discards. */}
          <KindField defaultValue={p.kind} />
          <TagField
            id={`edit-tags-${p.id}`}
            options={props.tagOptions}
            value={editTags}
            onChange={setEditTags}
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="composer-actions">
            {/* The form's own 保存 — the keyboard's way, right after the last
                field. The round 保存 at the corner (CornerButton) submits this
                same form; it is the thumb's way. */}
            <button type="submit" className="primary" disabled={busy}>
              保存
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                props.onEditEnd();
              }}
            >
              やめる
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="post">
      <div className="post-meta">
        {/* 「いま積んだ」 shows the moment; a 苔片 stacked on a past day, or a
            続く苔片, shows its days — a 続く苔片 its 厚み too (ADR-0007) — and,
            small, the day it was written on (features.md §1). The days are the
            server's keys, compared only. */}
        {isStackedNow(p) ? (
          <time className="hint" dateTime={new Date(p.createdAt).toISOString()}>
            {fmtDate(p.createdAt)}
          </time>
        ) : (
          <>
            <span className="hint post-days">
              <time dateTime={p.firstDay}>{slashDay(p.firstDay)}</time>
              {p.firstDay !== p.lastDay && (
                <>
                  {" 〜 "}
                  <time dateTime={p.lastDay}>{slashDay(p.lastDay)}</time>
                </>
              )}
              {p.thickness !== null && ` · ${thicknessLabel(p.thickness)}`}
            </span>
            <span className="hint post-posted">
              <time dateTime={p.postedDay}>{postedLabel(p.postedDay, p.lastDay)}</time> に積む
            </span>
          </>
        )}
        {/* The 向き as a word (never colour alone); its dot repeats the 総草's
            hue so the two vocabularies meet. 未分類 wears nothing. */}
        {p.kind !== null && (
          <span className={`post-kind ${p.kind}`}>{KIND_LABELS[p.kind]}</span>
        )}
      </div>
      {/* 本文は Markdown。描画器は HTML 文字列を作らない（markdown.tsx / ADR-0004）。 */}
      <Markdown source={p.body} className="post-body md" />
      {p.tags.length > 0 && (
        <ul className="post-tags" role="list">
          {p.tags.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="tag-chip"
                aria-label={`「${t.name}」で絞り込む`}
                onClick={() => props.onTagTap(t)}
              >
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="post-actions">
        {/* 同じ石に積む (CONTEXT.md): its stones and its 向き travel, nothing
            else — and only when it has stones; a bare 苔片 would just be 積む
            again. */}
        {p.tags.length > 0 && (
          <button type="button" disabled={busy} onClick={() => props.onSameStones(p)}>
            同じ石に積む
          </button>
        )}
        {/* Disabled, not hidden, while another 苔片 is being edited: the corner
            holds one 保存, and closing that form (保存 or やめる) frees this. */}
        <button
          type="button"
          disabled={busy || editLocked}
          onClick={() => {
            setEditBody(p.body);
            setEditDays(daysFieldsOf(p));
            setEditTags({ tags: stoneNames(p.tags), text: "" });
            props.onEditStart(p.id);
          }}
        >
          編集
        </button>
        <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
          削除
        </button>
      </div>
      {/* Native modal: showModal traps focus and handles Esc; closedby="any"
          adds backdrop light-dismiss where supported. Esc/backdrop/やめる all
          close with an empty returnValue — only the explicit 削除する submit
          carries "delete". */}
      {confirming && (
        <dialog
          ref={confirmRef}
          className="confirm"
          closedby="any"
          aria-labelledby={`confirm-delete-${p.id}`}
          onClose={() => {
            const decided = confirmRef.current?.returnValue === "delete";
            setConfirming(false);
            if (decided) void destroy();
          }}
        >
          <p id={`confirm-delete-${p.id}`}>
            <strong>この苔片を削除します。</strong>元に戻せません。
          </p>
          <blockquote className="confirm-preview">
            {p.body.length > 120 ? `${p.body.slice(0, 120)}…` : p.body}
          </blockquote>
          <form method="dialog" className="confirm-actions">
            <button type="submit" value="cancel">
              やめる
            </button>
            <button type="submit" value="delete" className="danger">
              削除する
            </button>
          </form>
        </dialog>
      )}
    </li>
  );
}

/**
 * PAT 管理（features.md §7）: 発行 → 一度きりの表示 → 一覧 → 失効。生のトークンが
 * 存在できるのは `created`（コンポーネント state）だけ — store にも URL にも
 * localStorage にも入れない。ページを離れたら忘れる、が「今だけ表示」の契約。
 */
function TokensSection() {
  const [tokens, setTokens] = useState<TokenSummary[] | null>(null);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTokens(await listTokens());
    } catch (e) {
      setError(describeApiError(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(describeApiError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      // クリップボードが使えない環境では <code> の user-select: all が受け皿。
    }
  };

  return (
    <>
      <p className="hint">
        別アプリ・CLI・エージェントが<strong>自分として</strong>苔片を積むための Bearer
        トークン。スコープは post:write（投稿のみ — タイムラインの閲覧はできない）。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = String(new FormData(form).get("tokenName") ?? "").trim();
          void run(async () => {
            setCopied(false);
            setCreated(await createToken(name));
          }).then((ok) => ok && form.reset());
        }}
      >
        <div className="field">
          <label htmlFor="tokenName">トークン名</label>
          <input
            id="tokenName"
            name="tokenName"
            required
            maxLength={100}
            autoComplete="off"
            placeholder="mazuoboeru など、送り側の名前"
          />
        </div>
        <button type="submit" disabled={busy}>
          発行
        </button>
      </form>
      {created && (
        <div role="status" className="token-once">
          <strong>「{created.name}」を発行しました。表示はこの一度きりです。</strong>
          <code>{created.token}</code>
          <div className="token-once-actions">
            <button type="button" onClick={() => void copy()}>
              {copied ? "コピーしました" : "コピー"}
            </button>
            <span className="hint">
              送り側の secret / 環境変数に控えたら閉じてよい。失くしたら失効して再発行。
            </span>
          </div>
        </div>
      )}
      {tokens === null ? (
        <p className="quiet">…</p>
      ) : tokens.length === 0 ? (
        <p className="quiet">まだトークンはありません。</p>
      ) : (
        <ul className="tokens">
          {tokens.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <span className="badge">{t.revokedAt !== null ? "失効済み" : "有効"}</span>
              </div>
              <p className="hint">
                作成 {fmtDate(t.createdAt)} ／ 最終使用 {fmtDate(t.lastUsedAt)}
                {t.revokedAt !== null && <> ／ 失効 {fmtDate(t.revokedAt)}</>}
              </p>
              {t.revokedAt === null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => revokeToken(t.id))}
                >
                  失効
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DevicesSection() {
  const [devices, setDevices] = useState<CredentialSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDevices(await listCredentials());
    } catch (e) {
      setError(describeAuthError(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      setError(describeAuthError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="hint">
        端末を失くしても入れるよう、2 台以上の登録を推奨（パスワードは存在しない）。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {devices === null ? (
        <p className="quiet">…</p>
      ) : (
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.id}>
              <div>
                <strong>{d.deviceName ?? "名前のない端末"}</strong>
                <span className="badge">{d.backedUp ? "同期" : "この端末のみ"}</span>
              </div>
              <p className="hint">
                登録 {fmtDate(d.createdAt)} ／ 最終使用 {fmtDate(d.lastUsedAt)}
              </p>
              <button
                type="button"
                disabled={busy || devices.length <= 1}
                onClick={() => void run(() => removeCredential(d.id))}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          void run(() => addDevice(String(fd.get("newDeviceName") ?? "").trim())).then(
            (ok) => ok && form.reset(),
          );
        }}
      >
        <div className="field">
          <label htmlFor="newDeviceName">この端末を追加（名前は任意）</label>
          <input id="newDeviceName" name="newDeviceName" maxLength={64} placeholder="iPhone など" />
        </div>
        <button type="submit" disabled={busy}>
          パスキーを追加
        </button>
      </form>
    </>
  );
}
