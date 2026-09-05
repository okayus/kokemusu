# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本が本番稼働、§8 は月セグメント棒（#38、本番デプロイ確認 2026-09-05）まで。Phase 1 の取りこぼしは空。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）、UI の目視は使い捨て spec（log #38）。

## 次の 3 手

1. **総草マスのタップ → その日の投稿一覧**（visualization.md §1。着地点 = `?from=&to=` の 1 日形は #37 で稼働済み）: ブランチは `origin/main` から（先に `git log --oneline origin/main..HEAD` — 未 merge の handoff commit があれば cherry-pick して同乗）。`Heatmap.tsx` の `HeatmapSection` に `onDayTap`、`rect.heatmap-cell` を `TagGraph.tsx` の石と同じ role=button + Enter/Space 契約に、`App.tsx` の `Garden` に `showPosts` の期間版（#37 の `postPeriod` / `periodKey` に着地 = チップ「YYYY/MM/DD ×」）。描画前に `modern-web-guidance`、merge 前に `pnpm e2e`（先に `ss -tlnp | grep 5183`）。
2. **年表の軸ラベル**（#38 で見えた既存の粗）: `TagTimeline.tsx` の `axisTicks` は本数（8）だけで間引いて幅を見ない → 390px の多年軸で年ラベルが重なり、1000px でも最後の年が「今日」に一部重なる。
3. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT passkey-session 変種 + pepper fail-closed 変種 + drizzle batch `.as()` 罠（#32）+ 作業ブランチは main の squash 後から切る（#34）+ 公開リポの check-runs を素の curl で読む（#35）+ Markdown はトークン → フレームワーク要素（#36 / ADR-0004）+ 期間フィルタは日窓 `?from=&to=` の 1 形・逆転はネイティブ `min`/`max` で止める（#37）+ 月バケットもコア・目視は使い捨て spec（#38）。

## 詰まり・人手待ち

- 本番実データの目視: §6 の見た目 / タグ絞り込み 3 導線 / 苔片の編集・削除 / Markdown 描画 / 期間絞り込み / **月セグメント棒**（#32〜#38 ともデプロイは確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
