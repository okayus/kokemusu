# 厚み —— 続く苔片の量 ＝ 日数 × 厚み（ADR-0007）

決定は [ADR-0007](../adr/0007-spanning-post-amount-is-days-times-thickness.md) と [CONTEXT.md](../../CONTEXT.md)（厚み・量）。
ここは実装の割り方と落とし穴だけ。完了したらこのファイルは削除（経緯は log）。

## PR 1 — 列 ＋ API ＋ core（`claude/thickness-api`。migration を含むので人の merge、auto-merge は arm しない）

- `worker/db/schema.ts`: `thickness: integer("thickness")`（NULLABLE。コメントに ADR-0007 と「単日は常に NULL」）。
  `drizzle-kit generate` → `0006_post_thickness.sql` は `ALTER TABLE post ADD thickness integer` の 1 文のはず
  （再構築マーカー無し ＝ `migrations.test.ts` がそのまま通る）。ローカルは `pnpm db:migrate`。
- core（`worker/core/day.ts` の隣に `core/amount.ts`）: 純粋関数だけ。
  `spanDays(span)`（両端含む日数）、`amountOf({ firstDay, lastDay, thickness }, clip?)` ＝ 重なる日数 × thickness / 100
  （thickness null → 1、クリップで重ならなければ 0）、`thicknessOf(amount, days)` ＝ 量 ÷ 日数（年表の注記。SPA 側にも写す）、
  `thicknessAllowed(span, thickness)` ＝ 単日なら null に限る。
- `worker/routes/posts.ts`: `createPostSchema` に `thickness: z.number().int().min(1).max(100).nullable().optional()`。
  POST は `thickness ?? null`、PATCH は `parsed.data.thickness === undefined ? owned.thickness : parsed.data.thickness`
  （日と同じ据え置き）。どちらも `thicknessAllowed` で外れれば 400。応答の苔片（create / list / PATCH）に `thickness`。
- `src/posts-api.ts` の `PostItem` / `PostInput` に `thickness`。
- テスト: 単体（量の関数、POST の単日 + 厚み 400、PATCH の据え置き・null で外す・単日に縮めて厚みが残れば 400）、
  e2e の PAT spec に「単日 + `thickness` は 400」「範囲 + 60 は 201 で応答に 60」。

## PR 2 — 集計（`claude/thickness-stats`。auto-merge 可）

- `/api/stats/graph`: ノード・橋を `COUNT` から量の和へ。SQL は `(tag_id, first_day, last_day, thickness)` の行、橋は
  `(a, b, first_day, last_day, thickness)` の行を返し、core で `amountOf` をクリップ付き（from ＝ `periodStartDay`、to ＝ 今日、
  `all` はクリップ無し）で足す。wire は `count` → `amount`（小数）。`nodeRadius` / `edgeWidth` は `amount` を読む
  （目盛りの飽和 ≈ 46 は実物を見てから決める）。`nodeTitle` / `edgeTitle` は「量 N」（丸めは `Math.round`、1 未満は 1 桁）。
- `/api/stats/timeline`: 行に `amount` を足し `count`（枚数）は残す。`months` は各月 その月に重なる日数 × 厚み
  （`bucketSpansByMonth` に厚みを通す。呼び出しは default / focus / tags の 3 形すべて）。`rowNote` は「量 N · 厚み x%」
  （厚み ＝ 量 ÷ 期間の日数、`Math.round`、100% 超えはそのまま）。
- 総草は触らない（`buildHeatmap` の各日 +1、`heatmapTotals` の枚数、キャプションの分母のまま）。
- テスト: 単体（クリップ、月ごとの量、注記）、e2e ゴールデンパスに 1 手（厚み 60% の 10 日の続く苔片 → 石の title「量 6」・年表の注記）。
  golden path の wire の深い等価（`days.at(-1)` の同族）は `amount` が入ると壊れる — 先に直す。

## PR 3 — UI（`claude/thickness-ui`。auto-merge 可）

- 書く前に `modern-web-guidance`（range ＋ datalist の目盛り ＋ output）。
- `DaysField` に 3 つ目の part「厚み」: `firstDay` と `lastDay` が両方入って異なるときだけ描く。スライダーは「空」を持てないので
  **チェック「厚みを付ける」（既定 off ＝ 厚みなし）＋ on のときスライダー** の形（推奨。0 の位置を「なし」に読ませるのは
  0% ≠ なし なので避ける）。`<input type="range" min="1" max="100" step="1" list>` に目盛り 14 / 60 / 71 / 100、
  `<output>` に「60% · 731 日のうち 439 日分」（日を伸ばせば追随）。
- `draft.ts` に `thickness: number | null`（旧形は null）。
- 送信: `stackDaysInput` の隣に `thicknessInput`（範囲でなければ null を送る。編集で単日に縮めたときも null を同送 —— サーバの 400 を踏まない）。
- カードの日の並びに「· 厚み 60%」、編集フォームの summary「日: … · 厚み 60%」。
- 使い捨て spec でライト / ダーク / 390px を目視（`kokemusu-visual-check-via-scratch-spec`）。docs の「未実装」を ✅ に。

## 落とし穴

- 単日に縮める PATCH は `thickness: null` を同送しないと 400（編集フォームは欄の全部を送るので UI 側で落とす）。
- `count` を読んでいたテスト・型（`GraphNode.count`、`Span.count`）が小数の `amount` で軒並み動く。
- `bucketSpansByMonth` の呼び出し元 3 箇所を全部厚み付きに（1 箇所忘れると年表の月だけ枚数のまま）。
