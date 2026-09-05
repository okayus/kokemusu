# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）まで本番稼働。次の塊は「過去に積む・続く苔片・向き」（2026-09-06 に grill 済み: ADR-0005 / CONTEXT.md / `docs/plans/day-axis-and-kind.md`）。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **A1 軸を「日」に**（plans §A1。振る舞いを変えない refactor、DoD ＝ e2e 11/11 がそのまま通る）: `post` に `first_day` / `last_day`（NOT NULL）＋ `kind` を足す**唯一の再構築 migration `0004`** — drizzle-kit の SQL を手で直す（`post_tags` を一時表に退避 → 復元、backfill は JST の `date()`）、`migrations.test.ts` の再構築検査はこの 1 本だけ許可。読む側 6 箇所を文字列比較（重なり）へ、カーソル 3 要素、`day` → `firstDay` ＋ `postedDay`。**drizzle を触るので人間 merge**（merge 前にホストで `wrangler d1 export`）。`origin/main` から切る、PR は `--title`。
2. **B 向き**（plans §B、migration なし）: `kind` の radio（Compose / 編集）、カードの印、総草の色相（青緑 / 赤茶 / 緑 × 5 段階、`dataviz` で検証）、凡例・読み上げ・比率。
3. **A2 過去に積む・続く苔片**（plans §A2、migration なし）: `firstDay` / `lastDay` の検証、「日を選ぶ」date 2 欄、カードの範囲 ＋「M/D に積む」、着地は「積みました ＋ その日に絞る」。

その後: エクスポート（#41 の比較表の推し）→ skill 書き戻し（log #32〜#41 の罠）→ 累積グラフ。

## 詰まり・人手待ち

- 本番実データの目視: #32〜#41 の UI 全部（デプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。着地したら二重投稿を観測 → `Idempotency-Key`（ADR-0002）。A2 後は `firstDay: 昨日` と `kind: "input"` を送れる。

## 進行中 PR

- **#42** 設計 docs（ADR-0005 ＋ CONTEXT.md ＋ plans ＋ features / data-model / visualization / security / roadmap）— `docs/adr/` を含むので人間 merge。merge 後 `git fetch --prune`、A1 は `origin/main` から切る。
