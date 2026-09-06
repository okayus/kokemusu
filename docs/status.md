# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 可視化の柱 3 本 ＋ 書く面のダイアログ化（#41）＋ 軸を「日」に（A1 #43、docs #45）＋ 向き（B #46）まで本番稼働。残りは A2 過去に積む・続く苔片（plans/day-axis-and-kind.md）。** 回帰検知は `pnpm e2e`（4 spec）、目視は使い捨て spec。

## 次の 3 手

1. **A2 過去に積む・続く苔片**（plans §A2、migration なし、auto-merge 可。`origin/main` から `claude/day-axis-a2`）: `posts.ts` で `firstDay` / `lastDay` を受けて検証（`isDayKey`、`first ≤ last ≤ dayKey(now)`、**古すぎる日も 400** — core の `enumerateMonths` は 1200 か月で throw。PATCH も同じ）→ `Compose.tsx` の `<details>`「日を選ぶ」に date 2 欄（`min` / `max` 相互、`max` ＝ 一覧の `today`。`draft.ts` に日）→ カードの範囲 ＋「M/D に積む」（いま積んだ苔片だけ時刻）→ 着地は `role=status`「積みました」＋「YYYY/MM/DD に絞る」。DoD = plans の e2e 1 手。終わったら features / visualization の「未実装」を消し plans を削除。
2. **エクスポート**（#41 の比較表の推し。形式・範囲を grill で決めてから）。
3. **skill 書き戻し**（log #32〜#46 の罠。0004 の drizzle-kit は `cloudflare-d1-drizzle-migration`、使い捨て spec の seed 束ねは `playwright-e2e-in-docker-sandbox` へ）→ 累積グラフ。

## 詰まり・人手待ち

- **本番 `0004` の事後確認（ホスト）**: post / post_tags の COUNT が merge 前の export / COUNT と一致、`SELECT first_day, last_day, kind FROM post LIMIT 5` で日が入っている。ローカルは `pnpm dev` の前に `pnpm db:migrate`。
- 本番実データの目視: #32〜#46 の UI 全部（デプロイ確認済み、目視だけ残）。向きは実データに無いので radio で付けてから総草の色相を見る。
- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1）の内容確認と merge。
- mazuoboeru 側の日次 push（別リポ。`KOKEMUSU_PAT` / `KOKEMUSU_URL` は mazuoboeru の wrangler に）。いまから `kind: "input"` を送れる、A2 後は `firstDay: 昨日` も。着地したら二重投稿を観測 → `Idempotency-Key`（ADR-0002）。

## 進行中 PR

- なし（handoff commit は `claude/handoff-2026-09-06` にローカルのみ → 次のブランチへ cherry-pick）。
