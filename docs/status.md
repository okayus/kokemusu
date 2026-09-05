# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本が本番稼働。Phase 1 取りこぼしは Markdown 描画（#36 / ADR-0004、本番デプロイ確認 2026-09-04）まで消化し、残りは期間絞り込み UI の 1 件。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **期間絞り込み UI**（Phase 1 取りこぼしの最後 — 通れば roadmap の「残り」が空になる）: 投稿一覧を期間で絞る。ブランチは **`origin/main` から**切る（pre-squash 履歴の同乗は #34 で CONFLICTING）。API は `GET /api/posts` に期間パラメータを足す（既存 keyset カーソルと両立させる。`?tags=` AND を WHERE に合流させた形が前例。JST 境界は core `dayKey`、語彙は stats の `?period=month|year|all` が既にある）。語彙の広さは features.md §3（日・週・月・年・カスタム範囲）で決める。UI は既存の絞り込みバー（`.feed-filter`）に載せ、**描画前に `modern-web-guidance`**。merge 前に `pnpm e2e`（先に `ss -tlnp | grep 5183`）。
2. **§8 の月セグメント棒**（visualization.md）。
3. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT passkey-session 変種 + pepper fail-closed 変種 + drizzle batch `.as()` 罠（#32）+ 作業ブランチは main の squash 後から切る（#34）+ 公開リポの check-runs を素の curl で読む credential-free デプロイ確認（#35）+ **Markdown はサニタイザ + innerHTML ではなくトークン → フレームワーク要素**（#36 / ADR-0004。シンクを消す vs フィルタする。厳格 CSP を触らずに済む）。

## 詰まり・人手待ち

- 本番実データの目視: §6 の見た目 / タグ絞り込み 3 導線 / 苔片の編集・削除 / **Markdown 描画**（#32〜#36 ともデプロイは確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
