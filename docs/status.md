# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 1 MVP・最初の縦切り「投稿 → タグ → ヒートマップに 1 マス点く」の PR1 から。** PR の並び・DoD・リスクは [plans/vertical-slice.md](plans/vertical-slice.md)。本番 `https://kokemusu.shiraoka.workers.dev` はまだ歩く骨格（ロジック = ゼロ）。

## 次の 3 手

1. **PR1 — スキーマ + Drizzle 配線（ルート無し）**: `drizzle-orm` / `drizzle-kit` を足し、`worker/db/schema.ts` + `drizzle.config.ts` で 6 テーブル（`user` / `credential` / `session` / `post` / `tag` / `post_tags`）を `generate`。出力が nested なら `wrangler.jsonc` に `migrations_pattern`、`0000_init` との連番衝突に注意。検証 = `pnpm db:migrate` 後に `migrations list --local` が未適用 0 件・生成 SQL に `DROP TABLE` 無し。**着手前に skill `cloudflare-d1-drizzle-migration` 必読。**
2. PR1 merge 後、ホストで `pnpm exec wrangler d1 migrations list kokemusu-db --remote` = 未適用 0 件を確認（本番マイグレが deploy command で当たっているかの答え合わせ。残るなら dash を直すか `db:migrate:prod` 運用に）。
3. **PR2 — パスキー認証 + CSP**。**初回登録で `RP_ID` が永久確定**。先にホストで `SESSION_SECRET` / `INITIAL_REGISTRATION_TOKEN` を `wrangler secret put`。

## 詰まり・人手待ち

- なし（PR1 はサンドボックス内で完結。`drizzle-kit generate` は Cloudflare 資格情報が要らない）。

## 進行中 PR

- なし。
