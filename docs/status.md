# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本が本番稼働、Phase 1 取りこぼしを回収中。投稿の編集・削除 完了（ADR-0003 = 物理削除でソフトデリート廃止、#34 merge + 本番デプロイ確認 2026-09-04）。** merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **`deleted_at` の drop migration（ADR-0003 の後始末）**: ブランチ `claude/drop-deleted-at` を **`claude/handoff-2026-09-04` から**切る（= origin/main + この handoff commit。pre-squash 履歴の同乗は #34 で CONFLICTING を起こした — log 2026-09-04）。`schema.ts` から `deletedAt` / `post_deleted_at_idx` を消して `pnpm db:generate` → 生成 SQL が **DROP INDEX → ALTER TABLE DROP COLUMN のみ**（`CREATE TABLE` なし = `post` 再構築なし）を確認し `migrations.test.ts` に固定（`cloudflare-d1-drizzle-migration` 必読）。**migration PR = auto-merge 禁止・人間 merge**（merge = Workers Builds が本番 D1 に適用）。merge 前に `pnpm e2e`（先に `ss -tlnp | grep 5183`）。
2. Phase 1 取りこぼしの残り: **Markdown + サニタイズ**（描画 UI の前に `modern-web-guidance`、DOMPurify 系 + CSP は security.md の XSS 行）→ 期間絞り込み UI。§8 月セグメント棒はその後。
3. **skill の書き戻し**（okayus-skills#41 merge 後にまとめて）: PAT passkey-session 変種 + pepper fail-closed 変種 + drizzle batch `.as()` 罠（#32）。新ネタ: **squash merge 運用では作業ブランチを必ず main の squash 後から切る**（#34 の CONFLICTING、log 2026-09-04）。

## 詰まり・人手待ち

- 本番実データの目視: §6 の見た目 / タグ絞り込み 3 導線 / **苔片の編集・削除**（#32/#33/#34 ともデプロイはプローブ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- mazuoboeru 側の日次 push 実装（別リポ。`KOKEMUSU_PAT` secret と `KOKEMUSU_URL` var は **mazuoboeru の** wrangler に置く）。着地したらタイムライン + トークン最終使用（最大 1h 遅れ）を確認、二重投稿を観測したら `Idempotency-Key` の判断（ADR-0002）。

## 進行中 PR

- なし。
