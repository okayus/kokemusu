# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — PAT は受け側・本番とも稼働状態（#31 merge + `PAT_PEPPER` 設定 + トークン発行済み、2026-09-03）。** 縦切りの並び **§8 → PAT → §6** の残りは §6。mazuoboeru の日次苔片は送り側実装（別リポ）が済み次第積まれ始める。merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **§6 タグ関係グラフを実装する**: ブランチ `claude/tag-graph` を `claude/handoff-2026-09-03` から切る（未 push の handoff commit を同乗させる — #31 と同じやり方）。設計は visualization.md §6 + data-model.md の共起クエリ（`post_tags` 自己 JOIN・`a.tag_id < b.tag_id`・期間は `post.created_at`）。ノードタップの着地 = §8 フォーカス（`getTimeline({focus})` が受け皿として実装済み）。可視化は自作 SVG、UI の前に `modern-web-guidance`。Phase 1 の取りこぼし（編集・ソフトデリート UI / Markdown + サニタイズ / タグ・期間絞り込み UI）と §8 後続強化はどこかで拾う。
2. **PAT skill の書き戻し**: `cloudflare-workers-pat-bearer-auth` の UNVERIFIED 2 件が kokemusu で検証済みに（passkey-session 変種 = `resolveSession` 抽出 + Variables `{userId, displayName, authMethod, scopes}` ／ API e2e spec 実走）。pepper fail-closed 化・PAT 到達面を絞る変種も添える。okayus-skills#41 merge 後にホストの okayus-skills を `main` に戻すのと合わせて。
3. mazuoboeru の日次 push が着地したら kokemusu 側で確認: タイムラインに出る + トークン一覧の最終使用が動く（最大 1h 遅れ）。二重投稿を観測したら `Idempotency-Key` を受け側に足す判断（ADR-0002 の「必要になってから」）。

## 詰まり・人手待ち

- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く — kokemusu 側ではない）。

## 進行中 PR

- なし（handoff commit 2 つが `claude/handoff-2026-09-03` に未 push — 次の機能 PR に同乗）。
