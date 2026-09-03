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
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { HeatmapSection } from "./Heatmap";
import {
  createPost,
  listPosts,
  listTags,
  splitTagField,
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
  return (
    <main className="shell">
      <header className="bar">
        <h1>苔むす</h1>
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
      </header>
      <p className="quiet">{props.user.displayName} の庭。</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Garden onSessionLost={props.onSessionLost} />
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

/** Composer + timeline: the daily surface. Owns the loaded page of 苔片. */
function Garden(props: { onSessionLost: () => void }) {
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

  // The filter moved: drop the shown page before this render's output so stale
  // 苔片 never sit under the new chips (the adjust-state-while-rendering
  // pattern, same as the 年表's focus). The epoch keeps a slow もっと遡る
  // answer from appending the old filter's page under the new one.
  const filterKey = rowKey(postFilter);
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
    listPosts(filterQuery(postFilter))
      .then((timeline) => {
        if (cancelled) return;
        setPosts(timeline.posts);
        setNextCursor(timeline.nextCursor);
      })
      .catch((e) => {
        if (!cancelled) fault(e);
      });
    return () => {
      cancelled = true;
    };
  }, [postFilter, fault]);

  const handleCreated = (created: PostItem) => {
    setError(null);
    // A 苔片 not carrying every filtered stone belongs off-screen — the moss
    // still darkens below, which is the visible receipt that it landed.
    if (postFilter.every((f) => created.tags.some((t) => t.id === f.id))) {
      setPosts((current) => [created, ...(current ?? [])]);
    }
    setMossVersion((v) => v + 1);
    // The post may have minted new stones — refresh the completion list.
    if (created.tags.length > 0) {
      void listTags()
        .then(setTagOptions)
        .catch(() => {});
    }
  };

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    const epoch = feedEpoch.current;
    setLoadingMore(true);
    try {
      const timeline = await listPosts({ cursor: nextCursor, ...filterQuery(postFilter) });
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

  return (
    <>
      <Composer
        tagOptions={tagOptions}
        onCreated={handleCreated}
        onSessionLost={props.onSessionLost}
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <HeatmapSection refreshKey={mossVersion} onFault={fault} />
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
          {postFilter.length > 0
            ? `${postFilter.map((t) => `「${t.name}」`).join("と")}で絞り込み中`
            : ""}
        </p>
        {postFilter.length > 0 && (
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
            <button type="button" className="feed-filter-clear" onClick={() => setPostFilter([])}>
              解除
            </button>
          </div>
        )}
        <Timeline posts={posts} filtered={postFilter.length > 0} onTagTap={(t) => showPosts([t])} />
        {nextCursor !== null && (
          <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
            もっと遡る
          </button>
        )}
      </section>
    </>
  );
}

function Composer(props: {
  tagOptions: TagSummary[];
  onCreated: (created: PostItem) => void;
  onSessionLost: () => void;
}) {
  // The draft survives reloads and failed submits (plans PR4: localStorage 退避).
  const [draft] = useState(loadDraft);
  const [body, setBody] = useState(draft?.body ?? "");
  const [tagField, setTagField] = useState(draft?.tags ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (nextBody: string, nextTags: string) => {
    setBody(nextBody);
    setTagField(nextTags);
    saveDraft({ body: nextBody, tags: nextTags });
  };

  const submit = async () => {
    if (busy) return;
    if (body.trim().length === 0) {
      setError("本文が空です。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPost({ body, tags: splitTagField(tagField) });
      // The body is spent; the tags usually carry over to the next 苔片.
      update("", tagField);
      props.onCreated(created);
    } catch (e) {
      // The entry stays in the fields (and in the saved draft) on failure.
      if (isApiError(e) && e.status === 401) props.onSessionLost();
      else setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitOnCmdEnter = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="field">
        <label htmlFor="post-body">いまの苔片</label>
        <textarea
          id="post-body"
          name="body"
          required
          maxLength={20000}
          rows={3}
          value={body}
          placeholder="なにを積む？"
          onChange={(e) => update(e.target.value, tagField)}
          onKeyDown={submitOnCmdEnter}
        />
      </div>
      <div className="field">
        <label htmlFor="post-tags">タグ（コンマ区切り・任意）</label>
        <input
          id="post-tags"
          name="tags"
          list="tag-options"
          autoComplete="off"
          maxLength={500}
          value={tagField}
          placeholder="typescript, 読書"
          onChange={(e) => update(body, e.target.value)}
          onKeyDown={submitOnCmdEnter}
        />
        <datalist id="tag-options">
          {props.tagOptions.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="composer-actions">
        <button type="submit" className="primary" disabled={busy}>
          積む
        </button>
        <span className="hint">⌘/Ctrl + Enter でも積めます</span>
      </div>
    </form>
  );
}

function Timeline(props: {
  posts: PostItem[] | null;
  filtered: boolean;
  onTagTap: (tag: TagSummary) => void;
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
        <li key={p.id} className="post">
          <time className="hint" dateTime={new Date(p.createdAt).toISOString()}>
            {fmtDate(p.createdAt)}
          </time>
          {p.title !== null && <strong className="post-title">{p.title}</strong>}
          {/* Plaintext on purpose — React's default escaping is the whole
              renderer until Markdown + sanitising lands (outside PR4). */}
          <p className="post-body">{p.body}</p>
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
        </li>
      ))}
    </ol>
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
