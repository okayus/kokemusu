# 縦切り: タグのタイムライン（§8 フォーカス年表）

2026-09-03 の設計議論の実装。決定: 案件もタグで表す（見出しは軸にしない）・行 = タグ集合 AND・
単棒（月セグメントは後続）・フォーカスは自動 pairwise + チップで深掘り。
仕様は [visualization.md](../visualization.md) §8、クエリは [data-model.md](../data-model.md) 集計節、
タグ運用は [features.md](../features.md) §2。

## DoD

1. `GET /api/stats/timeline`（セッション必須・**BODY_KEY 不要**・`deleted_at` 除外）
   - 既定: 全タグの行（タグごと MIN/MAX/COUNT）を開始日順で返す
   - `?focus=<tagId>`: その石のみ + 石×共起タグの行を一括で返す（共起クエリの自己 JOIN）
   - `?tags=t1,t2,t3`: タグ集合 AND の 1 行（post ごと `HAVING COUNT(DISTINCT tag_id) = n`）
   - 単体テストは Node の `app.request()`（既存 `stats.test.ts` の隣）
2. 自作 SVG の横棒年表: 開始日順・件数と密度（期間÷件数）の注記・`light-dark()` トークン・
   markup テストで構造を固定（総草と同じ流儀）
3. フォーカス UI: 石タップ → 内訳年表、行へのチップ追加で 3 タグ以上に深掘り（ad-hoc・保存なし）
4. 本番目視: 案件タグ + 技術タグ付きの苔片を数枚投げ、フォーカス年表に段々が出る
5. e2e ゴールデンパスに 1 手: タグ 2 つ付き投稿 → タイムライン画面に行が現れる（`apps/web/e2e`）

## 決めごと（実装中に破らない）

- 集計は平文メタデータのみ。この経路に BODY_KEY を入れない
- 日付バケットが要るときは core の純粋関数（`Asia/Tokyo`）。SQL の `date()` は使わない（UTC ずれ）
- 月セグメント棒はこの縦切りに**含めない**（visualization.md §8 の後続強化）
