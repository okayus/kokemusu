# 過去に積む・続く苔片・向き — 実装計画（A1 → B → A2）

決定は [ADR-0005](../adr/0005-post-axis-is-day-range.md)（軸 ＝「日」の範囲）、[CONTEXT.md](../../CONTEXT.md)（続く苔片・向き）、
[roadmap.md](../roadmap.md) 決めること 10・11（grill 2026-09-06）。**A2 が本番稼働したらこのファイルは削除**（結論は ADR と log に残る）。

## 共通

- ブランチは `origin/main` から切る（`git log --oneline origin/main..HEAD` で handoff commit の同乗を確認）。PR は `--title` を渡す。
- 単体 `pnpm test`、型 `pnpm check`、回帰 `pnpm e2e`（4 spec は 1 つの sqlite を共有、`apps/web/e2e/README.md`）。目視は使い捨て spec（`e2e/zz-*.spec.ts`、commit 前に消す）。
- **wire（3 PR で共有）**
  - 積む / 直す body: `body`, `tags?`, `title?`, **`firstDay?`**, **`lastDay?`**（`YYYY-MM-DD`。省略 ＝ 今日、`lastDay` 省略 ＝ `firstDay`。
    `first ≤ last ≤ today` を JST で検証し、逆転・未来・非日付は 400）, **`kind?`**（`input` | `output` | `both`）。PAT も同じ body。
  - 苔片: `id, title, body, bodyFormat, createdAt, updatedAt, firstDay, lastDay, postedDay, kind, tags`。`day` は消して `firstDay` に。
    `postedDay` ＝ `dayKey(createdAt)`（サーバ）。「いま積んだ」＝ `firstDay === lastDay && firstDay === postedDay`（クライアントは比較だけ）。
  - 一覧のカーソル: `{ firstDay, createdAt, id }`（`decodeCursor` の検証に `isDayKey`）。並びは `(first_day DESC, created_at DESC, id DESC)`。
  - 期間はどこでも重なり: `first_day <= to AND last_day >= from`。

## A1 — 軸を「日」に（振る舞いを変えない refactor。migration あり ＝ 人間 merge）

DoD: 既存の e2e 11/11 が**そのまま**通る（`created_at` をずらす細工だけ `first_day` / `last_day` の UPDATE に）。続く苔片の読み側は単体で固定。

1. `schema.ts`: `post` に `firstDay` / `lastDay`（`text().notNull()`）と `kind`（`text()`、NULLABLE）。`created_at` のコメントを「投稿した瞬間」に。
   index を `(user_id, first_day, created_at)` に（旧 `post_user_id_created_at_idx` は drop）。
2. `drizzle/0004_*.sql`: `drizzle-kit generate` の再構築 SQL を**手で直す**: (a) `DROP TABLE post` の前に `CREATE TABLE post_tags_keep AS SELECT * FROM post_tags;`
   (b) `__new_post` への INSERT で `first_day = last_day = date((created_at + 32400000) / 1000, 'unixepoch')`（Tokyo は DST 無し、1 回限り）
   (c) rename 後に `INSERT INTO post_tags SELECT * FROM post_tags_keep; DROP TABLE post_tags_keep;`。
   `migrations.test.ts` の再構築マーカー検査は **この 1 本だけ**許可（理由コメント付き）。ローカル D1 に親子行を仕込んで適用 → `post` / `post_tags` の
   行数不変を確認。本番は runbook: merge 前にホストで `wrangler d1 export`（1Password 経路）→ merge（Workers Builds が適用）→ 行数確認。
3. `core/day.ts`: `enumerateMonths(from, to)`、`bucketSpansByDay(spans, from, to)`（窓との交差の各日 +1、`kind` ごとの 入 / 出 も）、
   月版。全部純粋関数 ＋ 表テスト。`dayKey` は書く側（`posts.ts` の create / patch）だけに残す。
4. `stats.ts`: heatmap ＝ 重なりで SELECT `first_day, last_day, kind` → core で展開、`total` ＝ 行数。timeline ＝ `MIN(first_day)` / `MAX(last_day)`、
   axis SQL は `first_day, last_day` → `monthCounts` は範囲展開（和 ≧ count）。graph ＝ `last_day >= periodStartDay`。`today` はそのまま。
5. `posts.ts`: create は `firstDay = lastDay = dayKey(now)`（A1 では body の日はまだ受けない）。list は並び・重なり・カーソル 3 要素。
   応答に `firstDay` / `lastDay` / `postedDay` / `kind`（`day` は削除 → `src/posts-api.ts`、`App.tsx` の `dayInPeriod(created.day, …)` を `firstDay` に）。
6. e2e: `UPDATE post SET created_at = created_at - 86400000` → `UPDATE post SET first_day = date(first_day, '-1 day'), last_day = first_day`
   （文字列の日付に対する `date()` は TZ 無関係）。
7. docs: data-model.md / visualization.md の「A1 までは」注記を消す。

## B — 向き（migration なし。auto-merge 可）

DoD: 3 択で積んだ苔片の色が総草に出る（e2e 1 手: input を 2 枚 → 今日のマスの読み上げに「インプット 2」、キャプションに比率）。

1. `posts.ts`: `createPostSchema` に `kind: z.enum(["input", "output", "both"]).optional()`、create / patch で保存、応答に載せる。
2. `Compose.tsx` / 編集フォーム（`App.tsx`）: 本文の下に `<fieldset>` の radio（インプット / アウトプット / 両方 ＋ 未分類に戻す手段）。
   `draft.ts` に `kind`（旧形は null）。`modern-web-guidance` を radio / fieldset の前に読む。
3. カード: 向きの小さな印（文字。色だけに頼らない）。
4. `Heatmap.tsx` ＋ `styles.css`: 日ごとの `{ count, input, output }` を wire に足し、色相クラス（入 / 出）× 5 段階。`--moss-*` は緑のまま、
   青緑と赤茶の 5 段階を `light-dark()` で足す。凡例に 2 色、`aria-label` に内訳、キャプションに「吸う x% · 出す y%」。`dataviz` で配色を検証してから固定。

## A2 — 過去に積む・続く苔片（migration なし。auto-merge 可）

DoD: e2e 1 手（昨日に 1 枚 → 昨日のマス +1・カードに時刻無し・「M/D に積む」／ 2 日の続く苔片 → 両日 +1・年表の月に出る・今日の窓で出る／
逆転は `rangeOverflow` で止まる・未来と非日付は 400）。

1. `posts.ts`: `firstDay` / `lastDay` を受けて検証（`isDayKey`、`first ≤ last ≤ dayKey(now)`）。PATCH も同じ（続く苔片を「伸ばす」のはここ）。
2. `Compose.tsx`: `<details>`「日を選ぶ」に date 2 欄（`min` / `max` 相互、`max` ＝ 一覧の `today`）。summary に選んだ範囲。`draft.ts` に `firstDay` / `lastDay`。
3. カード: 「YYYY/MM/DD」「YYYY/MM/DD 〜 YYYY/MM/DD」＋「M/D に積む」（`postedDay`）。いま積んだ苔片だけ時刻。
4. 着地: `onCreated` で「いま積んだ」以外は `role=status`「積みました」＋ ボタン「YYYY/MM/DD に絞る」（`showPosts` の期間版を再利用）。
5. features.md / visualization.md の「未実装」注記を消し、この計画を削除。
