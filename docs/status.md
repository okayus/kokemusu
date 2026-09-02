# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP — 縦切り + e2e（#26）完了、スキルシート方向の設計確定（#28、2026-09-03）。** 案件はタグで表す（見出しは軸にしない）。§8 タグのタイムラインは「行 = タグ集合 AND の単棒 + フォーカス」（visualization.md §8 / features.md §2 / security.md のぼかし規律）。縦切りの並びは **§8 → PAT → §6** に確定。仕事の苔片（案件タグ 1 + 技術タグ）は今日から積める。merge 前の回帰検知はコンテナ内 `pnpm e2e`（`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **縦切り「タグのタイムライン」を実装する**: ブランチ `claude/tag-timeline`、DoD は docs/plans/tag-timeline.md（`GET /api/stats/timeline` の 3 形 → SVG 横棒年表 → フォーカス UI → 本番目視 → e2e ゴールデンパスに 1 手）。BODY_KEY をこの経路に入れない・日付バケットは core の純粋関数（SQL の `date()` 禁止）。
2. その後 PAT（Phase 2 先頭、mazuoboeru が待つ）→ §6 タグ関係グラフ。Phase 1 の取りこぼし（編集・ソフトデリート UI / Markdown + サニタイズ / タグ・期間絞り込み UI）はどこかで拾う。
3. okayus-skills#41 の merge 後、ホストの okayus-skills を `main` に戻す（`git switch main && git pull`。コンテナの skills mount はホストの working tree なので、いまは PR ブランチの内容が見えている）。

## 詰まり・人手待ち

- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。

## 進行中 PR

- なし。
