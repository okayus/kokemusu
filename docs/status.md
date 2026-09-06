# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）＋ 軸を「日」に（#43）＋ 向き（#46）＋ 過去に積む・続く苔片（#47）＋ 右下の丸い「積む」（#48）＋ 見出し廃止（#49、ADR-0006）＋ タグ欄のチップ ＋ 候補（#50）まで本番稼働、実データ目視も済み。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **エクスポート**（#41 の比較表の推し。`main` から `claude/export`）: まず `grill-with-docs` で 形式（JSON / Markdown / 両方）・範囲（全期間 / `from`〜`to`）・出し方（ブラウザでダウンロード / R2 / PR）・復号の扱い（本文を復号して出す ＝ セッションのみ、PAT 不可）・ADR-0003 の「誤削除の受け皿」としての位置づけ を決めて ADR に落とす → その後に実装（route は session-only ＋ `no-store`、UI は設定パネルのボタン）。
2. **skill 書き戻し**（log #32〜#50 の罠。0004 の drizzle-kit と 0005 のガード誤爆は `cloudflare-d1-drizzle-migration`、使い捨て spec の seed 束ね・zz spec の巻き込み・React SSR の属性順と属性名・`getByText` の strict・blur でレイアウトが動くとクリックが消える は `playwright-e2e-in-docker-sandbox` / `cloudflare-workers-e2e-playwright` へ）。
3. **累積グラフ**（visualization.md の残り）→ `Idempotency-Key`（mazuoboeru の二重投稿を観測してから、ADR-0002）。

## 詰まり・人手待ち

- **本番 `0005` の事後確認（ホスト）**: `SELECT COUNT(*) FROM post` が merge 前と同じ、`SELECT name FROM pragma_table_info('post')` に `title` が無い。ローカルは `pnpm dev` の前に `pnpm db:migrate`。
- **mazuoboeru が `title` を送っていたら外す**（別リポ。ADR-0006 で知らないキーは 400 = 日次 push が落ちる。題が要るなら本文の 1 行目へ）。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に。着地したら二重投稿を観測 → `Idempotency-Key`。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。

## 進行中 PR

- なし（この handoff commit は `claude/handoff-2026-09-06` にローカルのみ → 次のブランチへ cherry-pick）。
