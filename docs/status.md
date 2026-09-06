# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）まで本番稼働。「過去に積む・続く苔片・向き」は設計（#42）と A1 実装（#43）が PR 中（ADR-0005 / plans/day-axis-and-kind.md）。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **A1 の着地（#43、`drizzle/0004` ＝ `post` の唯一の再構築 → 人間 merge）**: merge 前にホストで `wrangler d1 export kokemusu-db --remote` と post / post_tags の COUNT を控える → merge（Workers Builds が適用）→ COUNT 一致を確認（手順は #43 本文）。ローカルは `pnpm db:migrate`。#42 と #43 が両方 main に入ったら `git fetch --prune` → plans §A1-7（data-model.md / visualization.md の「A1 までは」注記を消す）を小 PR で。
2. **B 向き**（plans §B、migration なし、`origin/main` から切る）: `kind` の radio（Compose / 編集）、カードの印、総草の色相（青緑 / 赤茶 / 緑 × 5 段階、`dataviz` で検証）、凡例・読み上げ・比率。core は日ごとの 入 / 出 を既に返す（wire に載せるだけ）。
3. **A2 過去に積む・続く苔片**（plans §A2、migration なし）: `firstDay` / `lastDay` の検証（`first ≤ last ≤ today`。**古すぎる日も 400** — core の `enumerateMonths` は 1200 か月で throw）、「日を選ぶ」date 2 欄、カードの範囲 ＋「M/D に積む」、着地は「積みました ＋ その日に絞る」。

その後: エクスポート（#41 の比較表の推し）→ skill 書き戻し（log #32〜#41 の罠 ＋ 0004（drizzle-kit が NOT NULL 追加を ALTER TABLE ADD で吐く））→ 累積グラフ。

## 詰まり・人手待ち

- 本番実データの目視: #32〜#41 の UI 全部（デプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。着地したら二重投稿を観測 → `Idempotency-Key`（ADR-0002）。A2 後は `firstDay: 昨日` と `kind: "input"` を送れる。

## 進行中 PR

- **#42** 設計 docs（ADR-0005 ＋ CONTEXT.md ＋ plans ＋ features / data-model / visualization / security / roadmap）— `docs/adr/` を含むので人間 merge。
- **#43** A1 実装（#42 と独立に merge 可）— `drizzle/0004` を含むので人間 merge、runbook は PR 本文。単体 317 / e2e 11/11 / 適用リハーサル済み。
