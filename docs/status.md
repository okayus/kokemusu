# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP — 縦切り「投稿 → タグ → ヒートマップに 1 マス点く」完了（2026-09-02、DoD 1〜5 全通過）。** 本番 = ログイン → 投稿 → タイムライン + 総草で今日のマスが濃くなる。可視化の方向は転換済み: **ヒートマップは総草 1 枚だけ**、タグの打ち込みは「量 = グラフのノード成長 / 期間 = タグのタイムライン」（visualization.md §1/§6/§8）。

## 次の 3 手

1. **PR6（e2e、縦切りの仕上げ）**: 下欄の Chromium 焼き込み（人手）が通ったら着手。3 spec だけ — ゴールデンパス（登録 → 投稿 → 総草に 1 マス）/ 認証境界 401 / セキュリティヘッダ。skill `cloudflare-workers-e2e-playwright` + `playwright-e2e-in-docker-sandbox` の罠（ビルド成果物に `wrangler dev --persist-to .wrangler/state --ip 127.0.0.1`、e2e config から ratelimits を外す）どおりに。
2. **次の縦切りを 1 本選ぶ**: タグ関係グラフ（§6、石が投稿数で育つ）か タグのタイムライン（§8、最初〜最後の苔片の期間）か PAT（Phase 2 先頭、mazuoboeru が待つ）。集計クエリは data-model.md 集計節に既記。並びはユーザに確認してから。
3. Phase 1 の取りこぼしをどこかで拾う: 投稿の編集・ソフトデリート UI / Markdown + サニタイズ / タグ絞り込み・期間の UI（roadmap.md Phase 1）。

## 詰まり・人手待ち

- PR6 の先行人手: Chromium をイメージに焼く `.docker/Dockerfile` 変更 → ホストで `docker compose down && docker compose build && ./up.sh`。
- スキル書き戻し（ホスト。コンテナの okayus-skills は ro mount）: `cloudflare-workers-passkey-auth` = UNVERIFIED 3 件解消・`__Host-` 削除罠・secret put パイプ罠（詳細は #14 / #15）、`playwright-e2e-in-docker-sandbox` = Trap 1 は現行版 vite dev では再現せず（ratelimits ローカル実動）。

## 進行中 PR

- なし。
