# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）＋ 軸を「日」に（A1 #43）＋ 向き（B #46）＋ 過去に積む・続く苔片（A2 #47）まで本番稼働。plans/day-axis-and-kind.md は完了で削除済み。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **エクスポート**（#41 の比較表の推し。`main` から `claude/export`）: まず `grill-with-docs` で 形式（JSON / Markdown / 両方）・範囲（全期間 / `from`〜`to`）・出し方（ブラウザでダウンロード / R2 / PR）・復号の扱い（本文を復号して出す ＝ セッションのみ、PAT 不可）・ADR-0003 の「誤削除の受け皿」としての位置づけ を決めて ADR に落とす → その後に実装（route は session-only ＋ `no-store`、UI は設定パネルのボタン）。
2. **skill 書き戻し**（log #32〜#47 の罠。0004 の drizzle-kit は `cloudflare-d1-drizzle-migration`、使い捨て spec の seed 束ね・zz spec の巻き込み・React SSR の属性順・`getByText` の strict は `playwright-e2e-in-docker-sandbox` / `cloudflare-workers-e2e-playwright` へ）。
3. **累積グラフ**（visualization.md の残り）→ `Idempotency-Key`（mazuoboeru の二重投稿を観測してから、ADR-0002）。

## 詰まり・人手待ち

- **本番 `0004` の事後確認（ホスト）**: post / post_tags の COUNT が merge 前の export / COUNT と一致、`SELECT first_day, last_day, kind FROM post LIMIT 5` で日が入っている。ローカルは `pnpm dev` の前に `pnpm db:migrate`。
- 本番実データの目視: #32〜#47 の UI 全部（デプロイ確認済み、目視だけ残）。向きは radio で付けてから総草の色相を、過去に積むは「日を選ぶ」で 1 枚積んで受領の「に絞る」ボタンを見る。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。`kind: "input"` と `firstDay: 昨日` はどちらも本番で受けられる。着地したら二重投稿を観測 → `Idempotency-Key`。

## 進行中 PR

- なし（この handoff commit は `claude/handoff-2026-09-06` にローカルのみ → 次のブランチへ cherry-pick）。
