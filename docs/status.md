# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面（#41〜#51）＋ 見かた 2 つと選んだ石（#52 #53）まで本番稼働（#51〜#53 の実データ目視は残）。** 次は「厚み」（ADR-0007、`docs/plans/thickness.md`）。回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **厚み PR 1**（#54 の merge 後、`main` から `claude/thickness-api`。plans/thickness.md の PR 1）: `schema.ts` に `thickness` ＋ `check()` 3 つ → `0006` は 0004 の recipe で**手書き**の再構築（post_tags 退避・backfill 100・PRAGMA 無し）→ guard の免除 2 本目 → e2e sqlite の写しでリハーサル → `core/stacking.ts`（直和 ＋ parse / decode / encode / amountOf）→ routes ＋ 法則のテスト。migration を含むので人の merge。
2. **厚み PR 2 集計 → PR 3 UI**（plans/thickness.md）。その後 **エクスポート**（`grill-with-docs` で 形式・範囲・出し方・復号・ADR-0003 の受け皿 を決めて ADR → 実装）。
3. **skill 書き戻し**（log #32〜#50 の罠 → `cloudflare-d1-drizzle-migration` / `playwright-e2e-in-docker-sandbox` / `cloudflare-workers-e2e-playwright`）→ 累積グラフ → `Idempotency-Key`。

## 詰まり・人手待ち

- **#54 の merge（人手、docs のみ）**。merge 後にホストで `SELECT COUNT(*) FROM post WHERE first_day < last_day`（0006 の backfill 100 の対象。長い振り返りの 1 枚があれば PR 1 の後に画面で直す）。
- **本番 `0005` の事後確認（ホスト）**: `COUNT(*)` が merge 前と同じ、`pragma_table_info('post')` に `title` が無い。ローカルは `pnpm db:migrate`。
- **mazuoboeru が `title` を送っていたら外す**（ADR-0006 で 400）。着地したら二重投稿を観測 → `Idempotency-Key`。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の確認と merge。

## 進行中 PR

- **#54** `claude/spanning-post-thickness` — ADR-0007 ＋ CONTEXT.md ＋ plans/thickness.md ＋ docs（人の merge。この handoff commit も同乗）。
