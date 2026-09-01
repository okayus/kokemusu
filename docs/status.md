# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP・縦切り「投稿 → タグ → ヒートマップに 1 マス点く」— PR4（投稿 API + 最小タイムライン）まで本番稼働、次は PR5。** 並び・DoD・リスクは [plans/vertical-slice.md](plans/vertical-slice.md)。本番 = パスキーでログインして投稿でき、タイムラインに出る（BODY_KEY 設定済み、DoD 1〜3 通過。ヒートマップはまだ無い）。

## 次の 3 手

1. **PR5 — ヒートマップ集計 + 自作 SVG**（plans の PR5 節 = DoD 4「今日のマスが 1 段濃くなる」）: `worker/core/day.ts` に `APP_TZ = "Asia/Tokyo"` の `dayKey` / `bucketByDay`（純粋関数、境界 00:00 / 08:59 / 23:59・うるう年・月跨ぎのテスト）→ `GET /api/stats/heatmap?tag=&from=&to=`（`created_at` と `tag_id` だけ・本文に触らない）→ 週=列・曜日=行の SVG、苔の濃淡 5 段（light/dark トークン）。
2. DoD 5 の目視（ホスト、未実施なら 1 回）: `wrangler d1 execute kokemusu-db --remote --command "SELECT substr(body,1,20) FROM post LIMIT 1"` が `k1.` 封筒を返す = 本番 D1 に平文が無いことの確定。
3. **PR6 — e2e 3 spec**（plans の PR6 節）: 先行の人手 = Chromium をイメージに焼く `.docker/Dockerfile` 変更 → ホストで `docker compose down && docker compose build && ./up.sh`。

## 詰まり・人手待ち

- スキル書き戻し（ホスト。コンテナの okayus-skills は ro mount）: `cloudflare-workers-passkey-auth` = UNVERIFIED 3 件解消・`__Host-` 削除罠・secret put パイプ罠（詳細は #14 / #15）、`playwright-e2e-in-docker-sandbox` = Trap 1 は現行版 vite dev では再現せず（ratelimits ローカル実動）。

## 進行中 PR

- なし。
