# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — #41〜#66 まで本番稼働（可視化の柱 3 本・書く面・見かた 2 つ・厚み・送り側契約・年表の棒と時代・#66 で石のつながりは選んだ石の届く範囲だけ＋スポットライト。#51〜#66 の実データ目視は残）。** 次は エクスポート。回帰検知は `pnpm e2e`、目視は使い捨て spec。

## 次の 3 手

1. **エクスポートの決定**（`grill-with-docs`: 形式（JSON / Markdown）・範囲（全部 / 期間 / 石）・出し方（設定 UI / API＋PAT）・復号は Worker が `BODY_KEY` で（ADR-0001）・ADR-0003（物理削除）の受け皿 → ADR-0009 ＋ docs。実装は次の PR、純粋関数（整形）と I/O（D1 → 復号 → 応答）を分ける）。
2. **実データ目視 ＋ 石の目盛り**（持ち主が本番で #51〜#66 を見る: 見かた 2 つ・選んだ石・厚みのスライダー・編集中の右下の ✓・同じ石に積む の向き・年表の吹き出しと時代の文字・#66 の隠れる / 薄れる（残った石が隅に寄る空白が気になるか。組み直しは石が飛ぶので退けた）。`nodeRadius` は量 ≈ 46 で飽和 — 据え置きか決める）。
3. **skill 書き戻し**（log #32〜#66 の罠 → `cloudflare-d1-drizzle-migration`（CHECK 追加も再構築 recipe）/ `playwright-e2e-in-docker-sandbox`（SVG の % 高さ・flex の max-content・anchor の名前・`isMobile` は iOS の文字拡大を再現しない）/ `cloudflare-workers-e2e-playwright`（ゴールデンパスの `timeout`）/ `cloudflare-workers-pat-bearer-auth` / `cloudflare-mcp-claude-tooling`（upstream は api.github.com contents で読む））→ 累積グラフ → `Idempotency-Key`。

## 詰まり・人手待ち

- **#64 の実機確認（人手）**: iPhone の Chrome で Markdown の苔片の文字と幅が戻ったか。まだ広がる苔片があれば本文（編集フォームの生テキスト）を貼る。
- **本番 `0006` の事後確認（ホスト）**: `post` / `post_tags` の COUNT が merge 前と同じ、`(first_day = last_day) <> (thickness IS NULL)` が 0 件、`thickness` 列と `post` の CHECK 3 つ。
- **送り側 mazuoboeru（人手）**: `pnpm kokemusu:schema` の再 vendoring PR → 次の活動日 00:15 JST の tick でタグ付きの石が立つのを `wrangler tail` で実測。
- okayus-skills#41（e2e / sandbox / passkey の版上げ）の確認と merge。

## 進行中 PR

- なし（この handoff commit は次の feature PR に同乗）。
