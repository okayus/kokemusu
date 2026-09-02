# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP — 縦切り「投稿 → タグ → ヒートマップに 1 マス点く」完了（2026-09-02、DoD 1〜5）+ e2e 3 spec（#26）。** 本番 = ログイン → 投稿 → タイムライン + 総草で今日のマスが濃くなる。可視化の方向: **ヒートマップは総草 1 枚だけ**、タグの打ち込みは「量 = グラフのノード成長 / 期間 = タグのタイムライン」（visualization.md §1/§6/§8）。merge 前の回帰検知はコンテナ内 `pnpm e2e`（`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **次の縦切りを 1 本選ぶ（並びはユーザに確認してから着手）**: タグ関係グラフ（§6、石が投稿数で育つ）/ タグのタイムライン（§8、最初〜最後の苔片の期間）/ PAT（Phase 2 先頭、mazuoboeru が待つ）。集計クエリは data-model.md 集計節に既記。選んだら `docs/plans/<topic>.md` に DoD を切り、ゴールデンパス spec に 1 手足すところまでを DoD に含める。
2. Phase 1 の取りこぼしをどこかで拾う: 投稿の編集・ソフトデリート UI / Markdown + サニタイズ / タグ絞り込み・期間の UI（roadmap.md Phase 1）。
3. okayus-skills#41 の merge 後、ホストの okayus-skills を `main` に戻す（`git switch main && git pull`。コンテナの skills mount はホストの working tree なので、いまは PR ブランチの内容が見えている）。

## 詰まり・人手待ち

- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。

## 進行中 PR

- なし。
