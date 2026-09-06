import { useCallback, useEffect, useRef, useState } from "react";
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
  submitOnCmdEnter,
  tagsField,
  useComposeShortcut,
  type ComposeRequest,
  type DaysFields,
} from "./Compose";
import { isStackedNow, placeInFeed, postedLabel, stackDaysInput } from "./days";
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
  splitTagField,
  updatePost,
  type PostItem,
  type TagSummary,
} from "./posts-api";
import { TagGraphSection } from "./TagGraph";
import { rowKey, TagTimelineSection } from "./TagTimeline";
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
  "範囲を伸ばすと、その日々に在った続く苔片になります。今日より先には伸ばせません。";

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
  // The 積む dialog's request lives here because two places raise it: the round
  // 積む at the bottom-right corner and the `n` key (resume the draft as it is)
  // up here, and a 苔片's 同じ石に積む (that 苔片's stones seeded) down in the
  // feed. Garden renders it.
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
  const openCompose = useCallback(() => setCompose({ seedTags: null }), []);
  useComposeShortcut(openCompose);
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
      {/* 積む, the round button fixed to the bottom-right corner (features.md
          §1): one tap from wherever the reader has scrolled to, under the thumb
          on a phone. Icon-only, so the name is on the button itself; styles.css
          hides it while a dialog is up. */}
      <button type="button" className="fab" aria-label="積む" title="積む" onClick={openCompose}>
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
      <p className="quiet">{props.user.displayName} の庭。</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Garden
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
  // The 年表's focused stone lives here because two sections write it: the
  // 年表's own chips and the graph's stones (§6 のノードタップの着地 = §8 フォーカス).
  const [timelineFocus, setTimelineFocus] = useState<TagSummary | null>(null);
  const timelineRef = useRef<HTMLElement | null>(null);
  // 投稿一覧のタグ絞り込み (features.md §3) — the landing of three 導線: a
  // 苔片's own chip (1 石), §8 フォーカスの「投稿一覧へ」(1 石), §6 の橋 (2 石).
  const [postFilter, setPostFilter] = useState<TagSummary[]>([]);
  // 期間の絞り込み (features.md §3): the reader's own 導線 — a preset or a
  // custom range from the 期間で絞る form — and it ANDs with the stones.
  const [postPeriod, setPostPeriod] = useState<Period | null>(null);
  // Server-decided today (JST), refreshed with every first page: the anchor
  // of 今日 / 今週 / 今月 / 今年, so the presets cut where the server cuts.
  const [today, setToday] = useState<string | null>(null);
  const feedRef = useRef<HTMLElement | null>(null);

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
  const filterKey = `${rowKey(postFilter)}|${periodKey(postPeriod)}`;
  const [shownFilterKey, setShownFilterKey] = useState(filterKey);
  const feedEpoch = useRef(0);
  if (shownFilterKey !== filterKey) {
    setShownFilterKey(filterKey);
    feedEpoch.current += 1;
    setPosts(null);
    setNextCursor(null);
  }

  useEffect(() => {
    listTags().then(setTagOptions).catch(fault);
  }, [fault]);

  useEffect(() => {
    let cancelled = false;
    listPosts(feedQuery(postFilter, postPeriod))
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
  }, [postFilter, postPeriod, fault]);

  /** Whether a 苔片 carries every filtered stone. */
  const carriesStones = (item: PostItem) =>
    postFilter.every((f) => item.tags.some((t) => t.id === f.id));

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
      // The dialog has closed and focus is back on its invoker — the bar, or a
      // 苔片 somewhere down the feed — so the new 苔片 at the head of the list
      // is usually off-screen: travel there, the 導線's own movement.
      if (shown) feedRef.current?.scrollIntoView({ block: "start" });
      props.onNotice({ text: shown ? "積みました" : "積みました（いまの絞り込みの外）" });
    } else {
      // A past day or a 続く苔片 is not at the head, so the feed stays put and
      // is never narrowed on the reader's behalf (features.md §1); the receipt
      // offers the narrowing instead — the 苔片's days as the period, with the
      // stones let go when it does not carry them, so the tap always lands on it.
      const days = { from: created.firstDay, to: created.lastDay };
      const stones = carriesStones(created) ? undefined : [];
      props.onNotice({
        text: "積みました",
        action: { label: `${periodLabel(days)} に絞る`, run: () => showPeriod(days, stones) },
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
        ...feedQuery(postFilter, postPeriod),
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

  // 導線の着地: filter, then travel (scroll-behavior in CSS honours reduced
  // motion). A same-set tap keeps the identity so nothing refetches, but still
  // travels — the intent is "show me those 苔片".
  const showPosts = (tags: TagSummary[]) => {
    setPostFilter((current) => (rowKey(current) === rowKey(tags) ? current : tags));
    feedRef.current?.scrollIntoView({ block: "start" });
  };

  // The period's twin, for the days of a 苔片 or the 総草's one day: the same
  // window the 期間で絞る form makes, so the chip reads the days and the fields
  // show them. The stones stay unless `stones` says otherwise: the cell counts
  // every 苔片 of the day, but a reader who narrowed to a stone asked for that
  // stone's, and the chips say both.
  const showPeriod = (period: { from: string; to: string }, stones?: TagSummary[]) => {
    if (stones !== undefined) {
      setPostFilter((current) => (rowKey(current) === rowKey(stones) ? current : stones));
    }
    setPostPeriod((current) => (periodKey(current) === periodKey(period) ? current : period));
    feedRef.current?.scrollIntoView({ block: "start" });
  };

  // The 総草's cell lands on that one day (visualization.md §1) — the same
  // 1-day window the 今日 preset makes, so the chip reads 「YYYY/MM/DD ×」.
  const showDay = (day: string) => showPeriod({ from: day, to: day });

  // Chips and the live announcement share one wording: stones by name, the
  // period as its chip text (a whole month reads as the month).
  const narrowedBy = [
    ...postFilter.map((t) => `「${t.name}」`),
    ...(postPeriod === null ? [] : [periodLabel(postPeriod)]),
  ];

  return (
    <>
      {/* One completion list for every tag field — the dialog's and the edit
          forms' — mounted with the garden rather than with the dialog. */}
      <datalist id="tag-options">
        {tagOptions.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
      {props.compose !== null && (
        <ComposeDialog
          seedTags={props.compose.seedTags}
          today={today}
          onCreated={handleCreated}
          onClose={props.onComposeClose}
          onSessionLost={props.onSessionLost}
        />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <HeatmapSection refreshKey={mossVersion} onDayTap={showDay} onFault={fault} />
      <TagTimelineSection
        ref={timelineRef}
        refreshKey={mossVersion}
        tagOptions={tagOptions}
        focusTag={timelineFocus}
        onFocusChange={setTimelineFocus}
        onShowPosts={(t) => showPosts([t])}
        onFault={fault}
      />
      <TagGraphSection
        refreshKey={mossVersion}
        onTagTap={(t) => {
          // §6 → §8: focus the 年表 on the tapped stone and travel there so the
          // answer is on screen. scrollIntoView reads scroll-behavior from CSS,
          // which is where reduced motion is honoured.
          setTimelineFocus(t);
          timelineRef.current?.scrollIntoView({ block: "start" });
        }}
        onEdgeTap={(a, b) => showPosts([a, b])}
        onFault={fault}
      />
      <section className="post-feed" ref={feedRef}>
        <h2>投稿一覧</h2>
        {/* The one polite live seat of the feed. Rendered before any filter
            exists — a region must already be in the tree when its text lands. */}
        <p className="visually-hidden" role="status">
          {narrowedBy.length > 0 ? `${narrowedBy.join("と")}で絞り込み中` : ""}
        </p>
        {narrowedBy.length > 0 && (
          <div className="feed-filter">
            <span className="feed-filter-label">絞り込み:</span>
            {postFilter.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tag-chip"
                aria-label={`「${t.name}」の絞り込みを外す`}
                onClick={() => setPostFilter((current) => current.filter((x) => x.id !== t.id))}
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
                setPostFilter([]);
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
          filtered={narrowedBy.length > 0}
          onTagTap={(t) => showPosts([t])}
          onSameStones={(tags) => props.onCompose({ seedTags: tagsField(tags) })}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          onSessionLost={props.onSessionLost}
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
  filtered: boolean;
  onTagTap: (tag: TagSummary) => void;
  onSameStones: (tags: TagSummary[]) => void;
  onUpdated: (updated: PostItem) => void;
  onDeleted: (id: string) => void;
  onSessionLost: () => void;
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
          onTagTap={props.onTagTap}
          onSameStones={props.onSameStones}
          onUpdated={props.onUpdated}
          onDeleted={props.onDeleted}
          onSessionLost={props.onSessionLost}
        />
      ))}
    </ol>
  );
}

/**
 * One 苔片: the read view with 編集/削除, or the inline edit form (the
 * composer's mirror — the same fields, uncontrolled so やめる simply
 * discards). Delete confirms through a native <dialog> showing
 * what dies; the deletion is physical and unrecoverable from the UI (ADR-0003).
 */
function PostEntry(props: {
  post: PostItem;
  today: string | null;
  onTagTap: (tag: TagSummary) => void;
  onSameStones: (tags: TagSummary[]) => void;
  onUpdated: (updated: PostItem) => void;
  onDeleted: (id: string) => void;
  onSessionLost: () => void;
}) {
  const p = props.post;
  const [editing, setEditing] = useState(false);
  // 編集中の本文と日だけ state（本文はプレビューが要り、日は 2 欄が互いを縛る）。
  // タグは form のまま。「編集」を押した時点の値で毎回蒔き直すので、
  // やめる ＝ 捨てる が保たれる。
  const [editBody, setEditBody] = useState(p.body);
  const [editDays, setEditDays] = useState<DaysFields>({
    firstDay: p.firstDay,
    lastDay: p.lastDay,
  });
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
      // row's own — the days only move when the form says where to.
      const updated = await updatePost(p.id, {
        body: input.body,
        tags: input.tags,
        kind: input.kind,
        ...stackDaysInput(input.days.firstDay, input.days.lastDay),
      });
      setEditing(false);
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
          className="post-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            void save({
              body: editBody,
              tags: splitTagField(String(fd.get("tags") ?? "")),
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
          <div className="field">
            <label htmlFor={`edit-tags-${p.id}`}>タグ（コンマ区切り・任意）</label>
            {/* list: the composer's datalist — one source of completion. */}
            <input
              id={`edit-tags-${p.id}`}
              name="tags"
              list="tag-options"
              autoComplete="off"
              maxLength={500}
              defaultValue={p.tags.map((t) => t.name).join(", ")}
              onKeyDown={submitOnCmdEnter}
            />
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="composer-actions">
            <button type="submit" className="primary" disabled={busy}>
              保存
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                setEditing(false);
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
            続く苔片, shows its days and — small — the day it was written on
            (features.md §1). The days are the server's keys, compared only. */}
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
        {/* 同じ石に積む (CONTEXT.md): only its stones travel, and only when it
            has some — a bare 苔片 would just be 積む again. */}
        {p.tags.length > 0 && (
          <button type="button" disabled={busy} onClick={() => props.onSameStones(p.tags)}>
            同じ石に積む
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setEditBody(p.body);
            setEditDays({ firstDay: p.firstDay, lastDay: p.lastDay });
            setEditing(true);
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
