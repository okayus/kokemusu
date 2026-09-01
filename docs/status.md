# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP・縦切り「投稿 → タグ → ヒートマップに 1 マス点く」— PR4 まで本番稼働、PR5（ヒートマップ）に着手中。** 並び・DoD・リスクは [plans/vertical-slice.md](plans/vertical-slice.md)。本番 = パスキーでログインして投稿でき、タイムラインに出る（DoD 1〜3 通過）。ヒートマップはまだ無い。

## 次の 3 手

日の軸 `worker/core/day.ts` は merge 済み（#22。`APP_TZ` / `dayKey` / `bucketByDay` / `dayStartMs` / `addDays` / `enumerateDays`、境界テスト 28 件）。PR5 の残りは 1 と 2。

1. **`GET /api/stats/heatmap?tag=&from=&to=`**（`claude/heatmap-api` を切る）: 窓は半開き `[dayStartMs(from), dayStartMs(addDays(to,1)))`、`post ⋈ post_tags` から `created_at` と `tag_id` だけ取る（本文に触らない）。`bucketByDay` + `enumerateDays` で密な日次系列にして返す。`tag` は norm 引き・未知タグは空。**窓の上限（53 週など）は route が 400 で返す** — `enumerateDays` の throw は呼び出し側のバグ止めであって仕様ではない。
2. **自作 SVG**（書く前に skill `modern-web-guidance`）: 週=列 / 曜日=行、苔の濃淡 5 段（light/dark トークン）、マスに `<title>`「8/23 · 2 件」、週の開始は日曜固定。格子のレイアウトに要るなら day.ts に曜日/週の関数を 1 つ足す。ここまでで PR5 = **DoD 4「今日のマスが 1 段濃くなる」**。
3. DoD 5 の目視（ホスト、1 回）: `wrangler d1 execute kokemusu-db --remote --command "SELECT substr(body,1,20) FROM post LIMIT 1"` が `k1.` 封筒を返す = 本番 D1 に平文が無いことの確定。

## 詰まり・人手待ち

- スキル書き戻し（ホスト。コンテナの okayus-skills は ro mount）: `cloudflare-workers-passkey-auth` = UNVERIFIED 3 件解消・`__Host-` 削除罠・secret put パイプ罠（詳細は #14 / #15）、`playwright-e2e-in-docker-sandbox` = Trap 1 は現行版 vite dev では再現せず（ratelimits ローカル実動）。
- PR6（e2e）の先行人手: Chromium をイメージに焼く `.docker/Dockerfile` 変更 → ホストで `docker compose down && docker compose build && ./up.sh`。

## 進行中 PR

- なし。`claude/heatmap` は endpoint と SVG が載ってから PR（1 PR = merge して困らない状態）。
