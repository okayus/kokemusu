# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP・縦切り「投稿 → タグ → ヒートマップに 1 マス点く」— PR1（スキーマ）済み、次は PR2。** 並び・DoD・リスクは [plans/vertical-slice.md](plans/vertical-slice.md)。本番 = 骨格 + 6 テーブル（ルート無し）。マイグレは merge するだけで deploy command が本番へ当てる（実証済み）。

## 次の 3 手

1. **PR2 — パスキー認証 + セキュリティヘッダ**（仕様 = plans/vertical-slice.md の PR2 節。着手前に skill `cloudflare-workers-passkey-auth`（single-user 変種）／`cloudflare-workers-bot-scan-defense`（レート制限は fail-open）／`cloudflare-workers-e2e-playwright`（CSP × Vite HMR）を読む）。最初の 1 手 = ローカル `ORIGIN` を `http://localhost:5273` に直す（`.dev.vars` / `.dev.vars.example` / dev-environment.md — ブラウザはホスト側 5273 で開くので、5173 のままだと Origin 検査が全 POST を 403 にする）。secret 未設定は fail closed（`403 registration_closed`）に = merge しても安全に。
2. PR2 merge 後の本番検証（人手・ホスト）: `wrangler secret put SESSION_SECRET` / `INITIAL_REGISTRATION_TOKEN` → 端末 2 台でパスキー登録（**初回登録で `RP_ID` が永久確定**）→ `wrangler secret delete INITIAL_REGISTRATION_TOKEN` で閉じる。
3. **PR3 — 本文暗号化コア**（`worker/core/crypto.ts`、[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)）。純粋関数のみで PR2 と独立 = 人手待ちの間に先行可。`BODY_KEY` はホストで `wrangler secret put` + 1Password に控え。

## 詰まり・人手待ち

- なし（PR2 の実装はサンドボックスで完結。人手が要るのは merge 後の本番検証 = 上の 2 だけ）。

## 進行中 PR

- なし。
