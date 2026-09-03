# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP — 縦切り §8 タグのタイムライン完了（#30、本番目視 OK 2026-09-03）。** 縦切りの並び **§8 → PAT → §6** の先頭が済み、次は PAT（Phase 2 先頭）。仕事の苔片（案件タグ 1 + 技術タグ、顧客固有名はタグに書かない）は本番で積み始められる。merge 前の回帰検知はコンテナ内 `pnpm e2e`（`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **PAT（API 自動投稿）を実装する**: ブランチ `claude/pat`。設計は features.md §7 / data-model.md `api_token` / ADR-0002、skill `cloudflare-workers-pat-bearer-auth` と（葉テーブル追加でも）`cloudflare-d1-drizzle-migration` を必読。`PAT_PEPPER` は**最初の token 発行より前に** Worker Secret へ。⚠️ migration を含む PR は auto-merge を arm しない（人間 merge — CLAUDE.md の例外）。送り側 mazuoboeru の日次投稿が待っている。
2. その後 §6 タグ関係グラフ（ノードタップの着地 = §8 フォーカス、`getTimeline({focus})` が受け皿として実装済み）。Phase 1 の取りこぼし（編集・ソフトデリート UI / Markdown + サニタイズ / タグ・期間絞り込み UI）と §8 後続強化（月セグメント棒・フォーカス → 投稿一覧の導線）はどこかで拾う。
3. okayus-skills#41 の merge 後、ホストの okayus-skills を `main` に戻す（`git switch main && git pull`。コンテナの skills mount はホストの working tree なので、いまは PR ブランチの内容が見えている）。

## 詰まり・人手待ち

- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。

## 進行中 PR

- なし。
