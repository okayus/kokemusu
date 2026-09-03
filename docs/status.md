# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 縦切り列 §8 → PAT → §6 を完走（§6 = #32 merge + 本番デプロイ確認、2026-09-03）。可視化の柱 3 本（総草・年表・石のつながり）が本番稼働。** 次は Phase 1 取りこぼしの回収から。merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **タグ絞り込み UI（Phase 1 取りこぼし筆頭）**: `?tag=` は API（posts route）もクライアント（`listPosts({tag})`）も実装済みで **UI だけが無い**。投稿一覧に絞り込みを足し、§8 フォーカスからの「投稿一覧へ」と §6 エッジタップ（両タグの投稿一覧）の導線をつなぐ。ブランチ `claude/tag-filter-ui` を `claude/handoff-2026-09-03` から切る（未 push の handoff commit を同乗 — #32 と同じやり方）。UI の前に `modern-web-guidance`。残る取りこぼし（編集・ソフトデリート UI / Markdown + サニタイズ）と §8 月セグメント棒はその後。
2. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT skill の passkey-session 変種（UNVERIFIED 2 件が検証済みに）+ pepper fail-closed 変種。新ネタ: **drizzle + D1 `batch()` はオブジェクト行のみ → 自己 JOIN の重複出力列名（両側 `tag_id`）で位置マッピング崩壊 → 明示 `.as()` 必須**（#32、stats.ts コメント参照）。
3. mazuoboeru の日次 push が着地したら kokemusu 側で確認: タイムラインに出る + トークン一覧の最終使用が動く（最大 1h 遅れ）。二重投稿を観測したら `Idempotency-Key` を受け側に足す判断（ADR-0002 の「必要になってから」）。

## 詰まり・人手待ち

- §6 の本番目視（実データで見た目とタップ着地を確認。デプロイ自体はバンドルのプローブで確認済み）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く — kokemusu 側ではない）。

## 進行中 PR

- なし。
