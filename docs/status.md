# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 + 総草マスのタップ + 年表の軸ラベル + 書く面のダイアログ化・同じ石に積む（#41、本番デプロイ確認 2026-09-05）が本番稼働。Phase 1 の取りこぼしは空。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`）、目視は使い捨て spec（log #38〜#41）。

## 次の 3 手

1. **エクスポート（JSON / Markdown）を `grill-with-docs` で詰めて着手**（#41 の比較表で推し: ADR-0003 の受け皿 2 層目が未実装のまま実データが増える・Phase 3 の keyless バックアップの入口・route 1 本 + ボタン）。決めること: 形式／平文かパスフレーズ暗号化か（security.md）／再認証（`session.created_at` の鮮度）／PAT の読み scope。`origin/main` から切る（先に `git log --oneline origin/main..HEAD`、handoff commit は cherry-pick して同乗）。PR は `--title` を渡す。
2. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: log #32〜#41 の各行の「罠」を該当 skill へ（PAT の passkey-session / pepper fail-closed 変種、drizzle batch `.as()`、squash 後から切る、check-runs は素の curl、Markdown → 要素、日窓 1 形、月バケット・使い捨て spec、マスのボタン化、軸ラベル px 間引き、dialog は `returnValue` で決定を運ぶ、e2e は sqlite 共有、古い gh は pending でも exit 1）。
3. **その次の柱の候補 = 累積グラフ**（年表の `months` の累積和で API 追加ゼロ、#41 の比較表）。エクスポートの後に grill。

## 詰まり・人手待ち

- 本番実データの目視: #32〜#41 の UI 全部（絞り込み 3 導線 / 編集・削除 / Markdown / 期間 / 月セグメント / マスのタップ / 軸ラベル / 積むダイアログ・同じ石に積む・受領・390px シート。デプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
