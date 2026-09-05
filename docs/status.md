# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本が本番稼働。Phase 1 の取りこぼしは期間絞り込み UI（#37、本番デプロイ確認 2026-09-05）で全部消化し、roadmap の「残り」は空。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **§8 の月セグメント棒**（visualization.md §8「単棒は歯抜け期間をぶっ通しに見せる」の後続強化）: ブランチは **`origin/main` から**切る（先に `git log --oneline origin/main..HEAD` — 未 merge の handoff commit があれば cherry-pick して同乗）。`/api/stats/timeline` の各行に活動月（`created_at` → core `dayKey` の `YYYY-MM`。SQLite `date()` は使わない）ごとの件数を足し、`TagTimeline.tsx` の `barGeom` を月セグメントに割って活動月だけ塗る（自作 SVG、markup は vitest で固定、描画前に `modern-web-guidance`）。merge 前に `pnpm e2e`（先に `ss -tlnp | grep 5183`）。
2. **総草マスのタップ → その日の投稿一覧**（visualization.md §1。着地点 = `?from=&to=` の 1 日形は #37 で稼働済み）: `HeatmapSection` に `onDayTap`、`rect` を §6 の石と同じ role=button + Enter/Space 契約に、`Garden` に期間版の showPosts。
3. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT passkey-session 変種 + pepper fail-closed 変種 + drizzle batch `.as()` 罠（#32）+ 作業ブランチは main の squash 後から切る（#34）+ 公開リポの check-runs を素の curl で読む（#35）+ Markdown はトークン → フレームワーク要素（#36 / ADR-0004）+ 期間フィルタは日窓 `?from=&to=` の 1 形・逆転はネイティブ `min`/`max` で止める（#37）。

## 詰まり・人手待ち

- 本番実データの目視: §6 の見た目 / タグ絞り込み 3 導線 / 苔片の編集・削除 / Markdown 描画 / **期間絞り込み**（#32〜#37 ともデプロイは確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
