# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面 ＋ 見かた 2 つと選んだ石（#41〜#53）＋ 厚みの DB / core / API（#55、`0006` 本番適用済み）まで本番稼働（#51〜#55 の実データ目視は残）。** 次は厚みの集計 → UI（ADR-0007、`docs/plans/thickness.md` PR 2 → PR 3）。回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **厚み PR 2 集計**（`main` から `claude/thickness-stats`、plans/thickness.md PR 2、auto-merge 可）: graph のノード・橋と timeline の行を量の和へ（`(tag_id, first_day, last_day, thickness)` → `decodeStacking` → `amountOf` をクリップ付きで足す。wire は `count` → `amount`、timeline は `count` を残して `amount` と量の `months`（呼び出し 3 形）、注記「量 N · 厚み x%」）。総草は触らない。golden path の wire の深い等価を先に直す。
2. **厚み PR 3 UI**（plans/thickness.md PR 3: `modern-web-guidance` → `DaysField` にスライダー ＋ 換算、`stackDaysInput` の 100 をスライダー値に、カード / summary に「厚み 60%」、使い捨て spec で目視、docs の「未実装」を ✅、plans 削除）。その後 **エクスポート**（`grill-with-docs` で 形式・範囲・出し方・復号・ADR-0003 の受け皿 → ADR → 実装）。
3. **skill 書き戻し**（log #32〜#55 の罠 → `cloudflare-d1-drizzle-migration`（CHECK 追加も再構築・退避 recipe）/ `playwright-e2e-in-docker-sandbox` / `cloudflare-workers-e2e-playwright`）→ 累積グラフ → `Idempotency-Key`。

## 詰まり・人手待ち

- **本番 `0006` の事後確認（ホスト）**: `post` / `post_tags` の COUNT が merge 前と同じ、`(first_day = last_day) <> (thickness IS NULL)` が 0 件、`pragma_table_info('post')` に `thickness`（`title` は無い）、`sqlite_master` の `post` に CHECK 3 つ。merge 前の export は無し（続く苔片 0 件）。
- **画面から積む範囲は PR 3 まで 100%（毎日）で送る**（`stackDaysInput` のつなぎ）。範囲を送る送り側は `thickness` 必須（mazuoboeru は単日で影響なし）。
- **送り側 mazuoboeru は `title` を送っていた（09-06 から毎晩 400）**。修正 PR は mazuoboeru 側。着地後に二重投稿を観測 → `Idempotency-Key`。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の確認と merge。

## 進行中 PR

- 送り側契約の公開（`docs/senders.md` ＋ 生成 schema、ADR-0008。人間 merge。handoff commit 同乗）。
