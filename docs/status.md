# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）＋ 軸を「日」に（A1、#43）まで本番稼働。「過去に積む・続く苔片・向き」は設計（ADR-0005、#42）と A1 が main に入り、B 向き → A2 過去に積む が残り（plans/day-axis-and-kind.md）。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **plans §A1-7 の小 PR（docs のみ、auto-merge 可、`origin/main` から）**: A1 が着地したので「A1 までは」「予定」「未実装」を実装済みの文に直す — data-model.md（7 行目付近の更新節・集計節 162・migration 節 198「`0004` 予定」・index 節 207）と visualization.md（§1 の「未実装 — plans」は過去に積む・続く苔片が A2 でまだ、§8 の 110 行）。
2. **B 向き**（plans §B、migration なし）: `kind` の radio（Compose / 編集）、カードの印、総草の色相（青緑 / 赤茶 / 緑 × 5 段階、`dataviz` で検証）、凡例・読み上げ・比率。core の `bucketSpansByDay` は日ごとの 入 / 出 を既に返す（wire に載せるだけ）。
3. **A2 過去に積む・続く苔片**（plans §A2、migration なし）: `firstDay` / `lastDay` の検証（`first ≤ last ≤ today`。**古すぎる日も 400** — core の `enumerateMonths` は 1200 か月で throw）、「日を選ぶ」date 2 欄、カードの範囲 ＋「M/D に積む」、着地は「積みました ＋ その日に絞る」。

その後: エクスポート（#41 の比較表の推し）→ skill 書き戻し（log #32〜#43 の罠。0004 の drizzle-kit の件は `cloudflare-d1-drizzle-migration` へ）→ 累積グラフ。

## 詰まり・人手待ち

- **本番 `0004` の事後確認（ホスト）**: post / post_tags の COUNT が merge 前の export / COUNT と一致、`SELECT first_day, last_day, kind FROM post LIMIT 5` で日が入っている。ローカルは `pnpm dev` の前に `pnpm db:migrate`。
- 本番実データの目視: #32〜#43 の UI 全部（デプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。着地したら二重投稿を観測 → `Idempotency-Key`（ADR-0002）。A2 後は `firstDay: 昨日` と `kind: "input"` を送れる。

## 進行中 PR

- なし。
