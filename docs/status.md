# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 + 総草マスのタップ（#39、本番デプロイ確認 2026-09-05）が本番稼働。Phase 1 の取りこぼしは空。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）、目視は使い捨て spec（log #38 / #39）。

## 次の 3 手

1. **年表の軸ラベル**（#38 で見えた粗）: `origin/main` から切る（先に `git log --oneline origin/main..HEAD`、handoff commit は cherry-pick して同乗）。`TagTimeline.tsx` の `axisTicks` は本数（8）だけで間引き幅を見ない → 390px の多年軸で年ラベルが重なり、1000px でも最後の年が「今日」に重なる。軸の px 幅 ÷ ラベル幅で本数を決め、最後の年と「今日」の衝突はどちらかを退ける。vitest + 使い捨て spec で確認。PR は `--fill --title "<feat の subject>"`（2 commit だと `--fill` がブランチ名をタイトルにする、log #39）。
2. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT passkey-session 変種 + pepper fail-closed 変種 + drizzle batch `.as()` 罠（#32）+ 作業ブランチは main の squash 後から切る（#34）+ 公開リポの check-runs を素の curl で読む（#35）+ Markdown はトークン → フレームワーク要素（#36 / ADR-0004）+ 日窓 `?from=&to=` の 1 形（#37）+ 月バケットもコア・目視は使い捨て spec（#38）+ 総草のマスのボタン化（roving tabindex・outline auto・grid item の `min-width: 0`）（#39）。
3. **Phase 2 の次の柱を決める**: roadmap.md の残り（全文検索 / 累積・ストリーク・内訳 / タグ運用 / 振り返り / エクスポート）から `grill-with-docs` で 1 本選んで着手。

## 詰まり・人手待ち

- 本番実データの目視: §6 の見た目 / タグ絞り込み 3 導線 / 苔片の編集・削除 / Markdown 描画 / 期間絞り込み / 月セグメント棒 / **総草マスのタップ + 右端 = 今日の横スクロール**（#32〜#39 ともデプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
