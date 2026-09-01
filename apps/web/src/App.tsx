import { useCallback, useEffect, useState } from "react";
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
import {
  createPost,
  listPosts,
  listTags,
  splitTagField,
  type PostItem,
  type TagSummary,
} from "./posts-api";
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
    </main>
  );
}

/** Composer + timeline: the daily surface. Owns the loaded page of 苔片. */
function Garden(props: { onSessionLost: () => void }) {
  const [posts, setPosts] = useState<PostItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tagOptions, setTagOptions] = useState<TagSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { onSessionLost } = props;
  const fault = useCallback(
    (e: unknown) => {
      // Any 401 funnels back to the login screen (useAuth.toAnonymous).
      if (isApiError(e) && e.status === 401) onSessionLost();
      else setError(describeApiError(e));
    },
    [onSessionLost],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [timeline, tags] = await Promise.all([listPosts(), listTags()]);
        setPosts(timeline.posts);
        setNextCursor(timeline.nextCursor);
        setTagOptions(tags);
      } catch (e) {
        fault(e);
      }
    })();
  }, [fault]);

  const handleCreated = (created: PostItem) => {
    setError(null);
    setPosts((current) => [created, ...(current ?? [])]);
    // The post may have minted new stones — refresh the completion list.
    if (created.tags.length > 0) {
      void listTags()
        .then(setTagOptions)
        .catch(() => {});
    }
  };

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const timeline = await listPosts({ cursor: nextCursor });
      setPosts((current) => [...(current ?? []), ...timeline.posts]);
      setNextCursor(timeline.nextCursor);
    } catch (e) {
      fault(e);
    } finally {
      setLoadingMore(false);
    }
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
      <Timeline posts={posts} />
      {nextCursor !== null && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          もっと遡る
        </button>
      )}
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

function Timeline(props: { posts: PostItem[] | null }) {
  if (props.posts === null) {
    return <p className="quiet">…</p>;
  }
  if (props.posts.length === 0) {
    return (
      <p className="quiet">まだ苔片がありません。ひとつ積むと、ここから苔むしていきます。</p>
    );
  }
  return (
    <ol className="posts">
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
            <ul className="post-tags">
              {p.tags.map((t) => (
                <li key={t.id} className="tag">
                  {t.name}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
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
