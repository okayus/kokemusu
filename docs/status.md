# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — #41〜#61 まで本番稼働（可視化の柱 3 本・書く面・見かた 2 つと選んだ石・厚み・送り側契約・タグ上限 99・編集中は右下が「保存」・同じ石に積む の向き。#51〜#61 の実データ目視は残）。** 次は エクスポート。回帰検知は `pnpm e2e`、目視は使い捨て spec。

## 次の 3 手

1. **エクスポートの決定**（`grill-with-docs`: 形式（JSON / Markdown）・範囲（全部 / 期間 / 石）・出し方（設定 UI / API＋PAT）・復号（`BODY_KEY` を持つ Worker が復号して出す — ADR-0001）・ADR-0003（物理削除）の受け皿 → ADR-0009 ＋ docs（features / security / data-model）。実装は次の PR で、純粋関数（整形）と I/O（D1 → 復号 → 応答）を分ける）。
2. **実データ目視 ＋ 石の目盛り**（持ち主が本番で #51〜#61 を見る: 見かた 2 つ・選んだ石・量の注記・厚みのスライダー・編集中の右下の ✓（親指位置、末尾の「保存」を残すか）・同じ石に積む の向き。`nodeRadius` は量 ≈ 46 で飽和 — 実物で据え置きか決める（直すなら使い捨て spec で再現））。
3. **skill 書き戻し**（log #32〜#61 の罠 → `cloudflare-d1-drizzle-migration`（CHECK 追加も再構築 recipe）/ `playwright-e2e-in-docker-sandbox` / `cloudflare-workers-e2e-playwright` / `cloudflare-workers-pat-bearer-auth`）→ 累積グラフ → `Idempotency-Key`。

## 詰まり・人手待ち

- **本番 `0006` の事後確認（ホスト）**: `post` / `post_tags` の COUNT が merge 前と同じ、`(first_day = last_day) <> (thickness IS NULL)` が 0 件、`pragma_table_info('post')` に `thickness`、`sqlite_master` の `post` に CHECK 3 つ。
- **送り側 mazuoboeru（人手）**: `pnpm kokemusu:schema` の再 vendoring PR → 次の活動日 00:15 JST の tick でタグ付きの石が立つのを host の `wrangler tail` で実測。
- **対応が要る: `modern-web-guidance` の SKILL.md が古い**（検索のたびに警告、2026_05_16 → 最新 2026_09_04。UI の案内が旧式になりうる）: `npx skills update`（SKILL.md と `skills-lock.json` が変わる）→ `.claude/**` なので arm せず人手 merge → search コマンドの `--skill-version` を新版にして警告が消えるのを確認。
- okayus-skills#41（e2e / sandbox / passkey の版上げ）の確認と merge。

## 進行中 PR

- なし（この handoff commit は次の feature PR に同乗）。
