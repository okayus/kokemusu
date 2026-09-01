# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP・縦切り「投稿 → タグ → ヒートマップに 1 マス点く」— PR2（パスキー認証）まで本番稼働、次は PR3。** 並び・DoD・リスクは [plans/vertical-slice.md](plans/vertical-slice.md)。本番 = 認証付き骨格（パスキー 2 台でログイン可・登録は閉鎖・`/api/*` は 401/403。投稿ルートはまだ無い）。

## 次の 3 手

1. **PR3 — 本文暗号化コア**（[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)、仕様は plans の PR3 節）: `apps/web/worker/core/crypto.ts` に AES-GCM 256・封筒 `k1.<iv>.<暗号文>` の `encryptBody` / `decryptBody`（鍵は引数で受ける純粋関数のみ）+ Node 単体テスト（往復・iv が毎回変わる・別鍵で失敗・封筒の形）。ログに平文・鍵・封筒を出さない。
2. PR3 merge 後の人手（ホスト）: `openssl rand -base64 32` の値を**先に表示して 1Password に控えてから** `wrangler secret put BODY_KEY` のプロンプトにペースト（パイプ直結は値が画面に出ない — PR2 の token で踏んだ罠。BODY_KEY は失うと本文が永久に復号不能）。
3. **PR4 — 投稿 API + 最小タイムライン**（plans の PR4 節）: 本文と title は保存直前に暗号化。UI を書く前に `modern-web-guidance`。

## 詰まり・人手待ち

- スキル書き戻し（ホスト。コンテナの okayus-skills は ro mount）: `cloudflare-workers-passkey-auth` = UNVERIFIED 3 件解消・`__Host-` 削除罠・secret put パイプ罠（詳細は #14 / #15 の本文とコメント）、`playwright-e2e-in-docker-sandbox` = Trap 1 は現行版 vite dev では再現せず（ratelimits ローカル実動）。

## 進行中 PR

- なし。
