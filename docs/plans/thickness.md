# 厚み —— 続く苔片は厚みを持ち、量 ＝ 日数 × 厚み（ADR-0007）

決定は [ADR-0007](../adr/0007-spanning-post-amount-is-days-times-thickness.md) と [CONTEXT.md](../../CONTEXT.md)（続く苔片・厚み・量）。
ここは実装の割り方と落とし穴だけ。完了したらこのファイルは削除（経緯は log）。

## PR 1 — 再構築 ＋ core ＋ API（`claude/thickness-api`。migration を含むので人の merge、auto-merge は arm しない）— ✅ 実装済み（2026-09-09、人の merge 待ち）

- `worker/db/schema.ts`: `thickness: integer("thickness")` と `check()`（`drizzle-orm/sqlite-core`）3 つ ——
  `post_days_ordered`: `first_day <= last_day`、`post_thickness_iff_span`: `(first_day = last_day) = (thickness IS NULL)`、
  `post_thickness_range`: `thickness IS NULL OR thickness BETWEEN 1 AND 100`。ルール 1 のコメントに「0006 が 2 度目の例外」を追記。
- `drizzle/0006_post_thickness.sql` は**手書き**（`drizzle-kit generate` は再構築を PRAGMA 付きで吐く。生成して meta の snapshot は
  生成のまま、SQL の中身だけ 0004 の形に書き換える）: `post_tags_keep` 退避 → `__new_post`（CHECK 付き）→ `INSERT … SELECT` で
  backfill（`CASE WHEN first_day < last_day THEN 100 ELSE NULL END`）→ `DROP TABLE post` → RENAME → index →
  `INSERT OR IGNORE` で `post_tags` 復元 → `post_tags_keep` を落とす。PRAGMA は書かない。ヘッダーの文言は guard の正規表現
  （`DROP TABLE` 等）に当たらない言い回しで。
- `worker/db/migrations.test.ts`: `REBUILDS_ON_RECORD` に 0006 を足し、0004 と同じく文の並びと「PRAGMA 無し」を固定するテストを足す。
- リハーサル（memory: kokemusu-d1-rebuild-migration-rehearsal）: `.wrangler/e2e` の sqlite を写して `--persist-to` で当て、
  `post` / `post_tags` / `tag` の行数不変、`pragma_table_info('post')` に `thickness`、`sqlite_master` の `post` の `sql` に CHECK 3 つ、
  続く苔片の行が 100・単日が NULL、単日に厚みを `UPDATE` すると CHECK で落ちる ことを確認。
- core（`worker/core/stacking.ts`、純粋関数だけ。`day.ts` の `canStackOn` はこの中に畳み、外から呼ぶ所が無くなれば消す）:
  ```ts
  /** 厚み（宣言した値）: 1〜100 の整数 %。唯一の constructor。 */
  export const thicknessSchema = z.int().min(1).max(100).brand<"Thickness">();
  export type Thickness = z.infer<typeof thicknessSchema>;
  /** 苔片が積み上がる日々（CONTEXT.md 日・続く苔片）。単日は厚みを持たない ＝ 1 枚 ＝ 1 日 × 100%。 */
  export type Stacking =
    | { on: "day"; day: DayKey }
    | { on: "days"; firstDay: DayKey; lastDay: DayKey; thickness: Thickness }; // firstDay < lastDay
  ```
  `parseStacking({ firstDay?, lastDay?, thickness? }, today): Stacking | null`（wire → domain。暦にある日・`first ≤ last ≤ today`・
  床より後 に加え、単日 ＋ 数・範囲 − 厚み（無し / null）は null。「検証して通す」ではなく「解釈して型にする」）、
  `decodeStacking(row): Stacking`（DB → domain。CHECK が守るはずの形が崩れた行 —— 単日に厚み・範囲に NULL・値域外・逆転 —— は
  `requireSpan` と同じく throw）、`encodeStacking(s): { firstDay, lastDay, thickness: number | null }`（domain → DB / wire。
  **NULL が生まれるのはここだけ**）、`daySpanOf(s): DaySpan`（総草・年表の既存関数へ渡す形 ＝ 総草は量を読まない、が型に出る）、
  `spanDays(s)`、`amountOf(s, window?): number`（day は 1、days は重なる日数 × 厚み / 100、重ならなければ 0）、
  `measuredThickness(amount, days): number`（年表の測った厚み。宣言の `Thickness` とは別の型で、小数で 1 を超えうる。SPA 側にも写す）。
- `worker/routes/posts.ts`: `createPostSchema` に `thickness: thicknessSchema.nullable().optional()`（zod が形と値域、意味は
  `parseStacking`）。POST は `parseStacking(body, today)` → null なら 400。PATCH は `decodeStacking(owned)` を土台に、日は省略 ＝
  据え置き、厚みは undefined ＝ 据え置き ／ null ＝ 無し ／ 数 ＝ 付け替え を当てて `parseStacking` → null なら 400
  （単日に縮めて厚みが残る・単日を伸ばして厚みを言わない はここで落ちる）。応答の苔片（create / list / PATCH）は `encodeStacking`。
- `src/posts-api.ts` の `PostItem` に `thickness: number | null`、`PostInput` に `thickness?: number | null`。
- テストは法則で: 単日 ＝ 1 ／ n 日 × 100 ＝ n ／ 731 日 × 60 ＝ 438.6 ／ 窓いっぱい ＝ クリップ無し、重ならなければ 0 ／
  parse: 単日 ＋ 60 → null、範囲 − 厚み → null、範囲 ＋ null → null、単日 ＋ null → day、範囲 ＋ 60 → days ／
  decode: 単日に 60・範囲に NULL・250・逆転 は throw ／ encode ∘ decode ＝ id ／ routes: POST の 400 3 種、PATCH の 据え置き・
  伸ばすのに厚み無し 400・縮めて厚み残り 400・縮めて null は 200・`lastDay` だけで伸ばしても厚みは残る。
  e2e の PAT spec に「単日 ＋ `thickness` は 400」「範囲だけは 400」「範囲 ＋ 60 は 201 で応答に 60」。

## PR 2 — 集計（`claude/thickness-stats`。auto-merge 可）

- `/api/stats/graph`: ノード・橋を `COUNT` から量の和へ。SQL は `(tag_id, first_day, last_day, thickness)` の行、橋は
  `(a, b, first_day, last_day, thickness)` の行を返し、`decodeStacking` → `amountOf` をクリップ付き（from ＝ `periodStartDay`、
  to ＝ 今日、`all` はクリップ無し）で足す。wire は `count` → `amount`（小数）。`nodeRadius` / `edgeWidth` は `amount` を読む
  （目盛りの飽和 ≈ 46 は実物を見てから決める）。`nodeTitle` / `edgeTitle` は「量 N」（`Math.round`、1 未満は 1 桁）。
- `/api/stats/timeline`: 行に `amount` を足し `count`（枚数）は残す。`months` は各月 その月に重なる日数 × 厚み
  （`bucketSpansByMonth` の隣に `amountByMonth(stackings)`。呼び出しは default / focus / tags の 3 形すべて）。`rowNote` は
  「量 N · 厚み x%」（厚み ＝ 量 ÷ 期間の日数、`Math.round`、100% 超えはそのまま）。
- 総草は触らない（`daySpanOf` で日々だけ渡す。`buildHeatmap` の各日 +1、`heatmapTotals` の枚数、キャプションの分母のまま）。
- テスト: 単体（クリップ、月ごとの量、注記）、e2e ゴールデンパスに 1 手（厚み 60% の 10 日の続く苔片 → 石の title「量 6」・
  年表の注記）。golden path の wire の深い等価（`days.at(-1)` の同族）は `amount` が入ると壊れる — 先に直す。

## PR 3 — UI（`claude/thickness-ui`。auto-merge 可）

- 書く前に `modern-web-guidance`（range ＋ datalist の目盛り ＋ output）。
- `DaysField` に 3 つ目の part「厚み」: `firstDay` と `lastDay` が両方入って異なるときだけ描く。
  `<input type="range" min="1" max="100" step="1" list>` 初期値 100、目盛り 14 / 60 / 71 / 100、`<output>` に
  「60% · 731 日のうち 439 日分」（日を伸ばせば追随）。単日に戻れば欄は消える。
- `draft.ts` に `thickness: number`（初期 100。範囲でなければ送らない。旧形は 100）。
- 送信: `stackDaysInput` を `stackingInput(fields)` に —— 範囲なら `{ firstDay, lastDay, thickness }`、単日なら
  `{ firstDay, lastDay, thickness: null }`（PATCH で縮めるときの null）、空なら `{}`。**PR 1 のつなぎ**: 画面が壊れないように
  `stackDaysInput(first, last, current)` が既にこの形を送る（範囲 ＝ `current ?? 100`、単日 ＝ null。積むは 100 固定、編集は
  `p.thickness`）。PR 3 はこの `100` をスライダーの値に置き換えるだけ。
- カードの日の並びに「· 厚み 60%」、編集フォームの summary「日: … · 厚み 60%」。
- 使い捨て spec でライト / ダーク / 390px を目視（memory: kokemusu-visual-check-via-scratch-spec）。docs の「未実装」を ✅ に。

## 落とし穴

- D1 は `PRAGMA foreign_keys=OFF` を無視して `post_tags` を cascade で消す —— 退避なしの `DROP TABLE post` は禁止（0004 と同じ）。
- `??` は null（無し）と undefined（据え置き）を潰す —— PATCH の三値は `=== undefined` で分ける。
- `thickness: number | null` を core に流さない —— 境界で `Stacking` に解釈し、core は `Stacking` だけを受ける。
- `count` を読んでいたテスト・型（`GraphNode.count`、`Span.count`、golden path の wire の深い等価）が小数の `amount` で動く。
- `bucketSpansByMonth` の呼び出し元 3 箇所を全部量に（1 箇所忘れると年表の月だけ枚数のまま）。
