# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）＋ 軸を「日」に（A1、#43。docs 追随 #45）まで本番稼働。「過去に積む・続く苔片・向き」は B 向き → A2 過去に積む が残り（plans/day-axis-and-kind.md）。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **B 向き**（plans §B、migration なし、auto-merge 可。`origin/main` から `claude/kind-direction`）: `posts.ts` に `kind` enum（create / patch・応答）→ `Compose.tsx` / `App.tsx` の radio `<fieldset>`（未分類に戻す手段も。`draft.ts` に `kind`、`modern-web-guidance` を先に）→ カードの文字の印 → heatmap wire に日ごとの `input` / `output`（core は既に返す）→ `Heatmap.tsx` + `styles.css` の青緑 / 赤茶 × 5 段階（`dataviz` で検証）、凡例・読み上げ・比率。DoD = e2e 1 手（input 2 枚 → 読み上げ「インプット 2」）。
2. **A2 過去に積む・続く苔片**（plans §A2、migration なし）: `firstDay` / `lastDay` の検証（`first ≤ last ≤ today`。**古すぎる日も 400** — core の `enumerateMonths` は 1200 か月で throw）、「日を選ぶ」date 2 欄、カードの範囲 ＋「M/D に積む」、着地は「積みました ＋ その日に絞る」。終わったら features / visualization の「未実装」を消し plans を削除。
3. **エクスポート**（#41 の比較表の推し。形式・範囲を grill で決めてから）。

その後: skill 書き戻し（log #32〜#45 の罠。0004 の drizzle-kit の件は `cloudflare-d1-drizzle-migration` へ）→ 累積グラフ。

## 詰まり・人手待ち

- **本番 `0004` の事後確認（ホスト）**: post / post_tags の COUNT が merge 前の export / COUNT と一致、`SELECT first_day, last_day, kind FROM post LIMIT 5` で日が入っている。ローカルは `pnpm dev` の前に `pnpm db:migrate`。
- 本番実データの目視: #32〜#43 の UI 全部（デプロイ確認済み、目視だけ残）。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。着地したら二重投稿を観測 → `Idempotency-Key`（ADR-0002）。A2 後は `firstDay: 昨日` と `kind: "input"` を送れる。

## 進行中 PR

- なし（handoff commit は `claude/handoff-2026-09-06` にローカルのみ → 次のブランチへ cherry-pick）。
