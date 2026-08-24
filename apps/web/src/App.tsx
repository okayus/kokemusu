import { useCallback, useEffect, useState } from "react";
import {
  addDevice,
  describeAuthError,
  listCredentials,
  removeCredential,
  supportsPasskeys,
  type AuthUser,
  type CredentialSummary,
} from "./auth-api";
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
  return <AuthedView user={auth.state.user} onLogout={auth.logout} />;
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

function AuthedView(props: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="shell">
      <header className="bar">
        <h1>苔むす</h1>
        <button
          type="button"
          onClick={() => void props.onLogout().catch((e) => setError(describeAuthError(e)))}
        >
          ログアウト
        </button>
      </header>
      <p className="quiet">
        {props.user.displayName} の庭。まだ何も生えていない — 苔片は次の縦切りで。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <DevicesSection />
    </main>
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
    <section className="panel" aria-labelledby="devices-heading">
      <h2 id="devices-heading">パスキー（端末）</h2>
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
    </section>
  );
}
