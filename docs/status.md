# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — #41〜#87 まで本番稼働（#87 でリンクで渡す — ADR-0009。#51〜#70 の実データ目視は残）。** 次は エクスポート。回帰検知は `pnpm e2e`、目視は使い捨て spec。

## 次の 3 手

1. **エクスポートの決定**（`grill-with-docs`: 形式・範囲・出し方・復号は Worker（ADR-0001）・ADR-0003 の受け皿・再認証（[plans/review-2026-11.md](plans/review-2026-11.md) ⑥）→ ADR-0010 ＋ docs。実装は次の PR で整形（純粋）と I/O を分ける）。
2. **実データ目視 ＋ 石の目盛り**（持ち主が本番で #51〜#70 を見る: 見かた 2 つ・選んだ石・厚み・右下の ✓・同じ石に積む の向き・年表の吹き出し・#70 の付け替え（確認文と受領の言葉）・#66 の隠れる / 薄れる。`nodeRadius` は量 ≈ 46 で飽和 — 据え置きか決める。総草の年の切り替えを足すかも決める — 同 plans ⑤）。
3. **skill 書き戻し**（[plans/skill-writeback.md](plans/skill-writeback.md)）。

その後: 累積グラフ → `Idempotency-Key`。

## 詰まり・人手待ち

- **#64 の実機確認（人手）**: iPhone の Chrome で Markdown の苔片の文字と幅が戻ったか。長い 1 行のコードブロックの苔片で横スクロールと文字の大きさを見る。
- **#80〜#82 の初回確認（人手）**: Actions「Audit」を Run workflow で 1 回流して green を見る。`wrangler tail` で毎時の `[cron] swept expired sessions: N` を見る。`.claude/skills/modern-web-guidance` は 2026_09_04 版で古い（最新 2026_11_16）ので持ち主が更新する。
- **#87 の実機確認（人手）**: 試しのリンクを端末で開き、ダイアログに入るのを見て「捨てる」。透き通るの導線ができたら、実装の場所を senders.md の送り側一覧に足す。
- **開発機の不調（人手）**: 2026-10-23 から、無関係なプロセスが数分間に相次いで落ちる（メモリの 1 bit 化けが疑わしい）。テストや git が SIGILL / SIGSEGV / abort で落ちたら、コードを疑う前に数分おいて再実行する。手当て: memtest86+ と BIOS のメモリ設定。

## 進行中 PR

- #84（描画中の例外で再読み込みの画面）・#85（アイコンと manifest）・#86（axe と jsx-a11y）: 2026-11-15 から OPEN。中身を見て merge か close を決める。
