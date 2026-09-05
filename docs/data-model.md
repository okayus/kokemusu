# データモデル

SQLite / D1 前提。1インスタンス＝1ユーザーだが、認証情報のためにユーザーレコードは持つ。
本文とメタデータを分離できる設計にしておく（暗号化と可視化の両立 → [security.md](security.md)）。

2026-09-06 更新: **苔片の軸を「日」の範囲に**（[ADR-0005](adr/0005-post-axis-is-day-range.md)。未実装 ——
[plans/day-axis-and-kind.md](plans/day-axis-and-kind.md) の A1 で `post` を 1 回だけ再構築）: `first_day` / `last_day`（日本時間の
`YYYY-MM-DD`、NOT NULL）が可視化・絞り込み・並びの軸になり、`created_at` は「投稿した瞬間」に戻る。**`kind`**（向き、NULLABLE）を
同じ再構築に同乗させる。

2026-09-03 更新: **`api_token` を実装**（`drizzle/0002_api_token.sql`。葉テーブルの追加のみ = 既存テーブル再構築なしを
生成 SQL とテスト `migrations.test.ts` の両方で確認）。`PAT_PEPPER` は fail closed —— 未設定なら発行が 503・Bearer 検証は
全部不一致になるので、「pepper 未設定のまま発行 → 後から設定して全滅」は起こり得ない。

2026-08-24 更新: 実スキーマを `drizzle/0001_kokemusu_schema.sql` として生成（[schema.ts](../apps/web/worker/db/schema.ts) が実物）。
`post_tags(post_id)` は PK の暗黙 index と重複するので張らないことにした。

2026-08-23 更新: `tag.norm`（表記ゆれの正規化キー）を追加、集計の「日」を `Asia/Tokyo` 固定に確定、
最初の実スキーマ（`0001`）に入れる範囲を明記。

2026-08-22 更新: 認証をパスキー single-user に確定（`password_hash` 廃止、`credential` / `session` を
`cloudflare-workers-passkey-auth` の形に合わせた）、API 自動投稿用の **`api_token`** と **`post.title`** を追加。

## 規約

- **id**: `text`、`crypto.randomUUID()`。例外は `credential.id`（WebAuthn の credential ID そのもの）。
- **日時**: `integer` の epoch ms で統一（passkey skill の ISO `TEXT` は苔むすでは epoch ms に読み替える。PAT skill は epoch ms）。
  **「日」は `text` の `YYYY-MM-DD`（日本時間）** —— 苔片が積み上がる軸 `post.first_day` / `last_day` は瞬間ではなく日なので、
  文字列比較がそのまま時系列比較になる（[ADR-0005](adr/0005-post-axis-is-day-range.md)）。
- **子テーブルは `user` に `ON DELETE CASCADE`**。⚠️ D1 は `PRAGMA foreign_keys=OFF` を無視するので、親テーブル（`user` / `post`）を**再構築する**マイグレ（NULL→NOT NULL、型変更、rename）は子行を cascade delete する罠（`cloudflare-d1-drizzle-migration`）。`user` の列は最初に決めきり、後から触らない。`post` は ADR-0005 で **1 回だけ**再構築する（`0004`、`post_tags` を退避して復元。データが少ないうちに）。
- **本文と title は暗号文、それ以外は平文**（[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)）。暗号文は `k<鍵ID>.<iv>.<暗号文>` の封筒で、鍵 `BODY_KEY` は Worker Secret。集計・可視化は平文のメタデータだけで成立する。
- 純粋関数で扱える形を優先（ストリーク計算・日付バケット化などは SQL でなくコアで。置き場所は当面 `apps/web/worker/core/`、共有する相手ができたら `packages/core` に切る）。

## エンティティ概観

```
user 1───* credential        (WebAuthn パスキー)
user 1───* session           (失効可能なサーバ側セッション)
user 1───* api_token         (API 自動投稿用 PAT)
user 1───* post
post *───* tag   (post_tags 中間テーブル)
tag  1───* tag_alias
post 1───* attachment        (将来)
```

## テーブル定義（案）

### user
唯一の利用者。パスキーのみなのでパスワード列は持たない。

| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK。`register/begin` 時に採番し WebAuthn の user handle にも使う |
| display_name | text | 表示名 |
| created_at | integer | epoch ms |

### credential（WebAuthn パスキー）
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text | PK。WebAuthn credential ID（base64url）。ログインは `response.id` でこれを引く |
| user_id | text | FK → user（cascade） |
| public_key | text | COSE 公開鍵を base64url で。BLOB にしない（ダンプ / `wrangler d1 execute` で読める） |
| counter | integer | 署名カウンタ。同期パスキー（iCloud / Google）は常に 0 → **`stored !== 0` のときだけ**退行チェック |
| transports | text? | JSON 配列（`internal` / `hybrid` …） |
| device_name | text? | 「MacBook」「iPhone」等のラベル |
| backed_up | integer (bool) | `credentialBackedUp`。端末紛失に耐えるか |
| created_at | integer | |
| last_used_at | integer? | |

### session
HS256 の JWT（`sid` クレーム）に**行で裏打ち**する。行を消せば即失効。期限は 30 日 sliding。
WebAuthn の challenge は **テーブルを持たない**（署名付き 5 分 cookie）。

| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text | PK。JWT の `sid` |
| user_id | text | FK → user（cascade） |
| expires_at | integer | 提示のたびに延長（sliding）。期限切れは提示時に lazy 削除 ＋ Cron で掃除 |
| created_at | integer | |

### api_token（API 自動投稿用 PAT）
別アプリ / CLI / エージェントが **自分として** `POST /api/posts` するための personal access token（[features.md](features.md) §7、`cloudflare-workers-pat-bearer-auth`）。

| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK。UI 表示と `DELETE /api/tokens/:id` に使う**公開 id**（token ではない） |
| user_id | text | FK → user（cascade） |
| name | text | 利用者が付けるラベル（例: `mazuoboeru`） |
| token_hash | text | `sha256(token + PAT_PEPPER)` の hex。**UNIQUE**。生の token は保存しない |
| scopes | text | JSON 配列。MVP は `["post:write"]` のみ（`post:read` は必要になったら） |
| created_at | integer | |
| last_used_at | integer? | 1 時間に 1 回までしか書かない（D1 書き込み抑制） |
| expires_at | integer? | null = 無期限（送り側が常駐 Worker なら無期限、人間の CLI なら 90 日など） |
| revoked_at | integer? | null = 有効。失効しても行は残す（いつ死んだか分かる） |

- token 形式: **`kokemusu_pat_` ＋ base64url(32 バイト乱数)**。発行時に **一度だけ** 返す。接頭辞は grep 用であって保護ではない（public リポの push protection は検知しない）。
- `PAT_PEPPER` は Worker Secret（`.dev.vars` にはローカル用の別値）。**最初の token 発行より前に設定**し、以後変えない（変えると全 token 無効）。
- 発行・一覧・失効は **セッション必須**（PAT で PAT は作れない）。他人の id への失効は 404（存在を漏らさない）。

### post（苔片）
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK |
| user_id | text | FK → user |
| title | text? | **任意の見出し**の暗号文（本文と同じ封筒・同じ鍵）。手動でも API でも付けられる（例: mazuoboeru の日次投稿「まず覚える 2026-08-22」）。null = 見出しなし |
| body | text | 本文（Markdown）の**暗号文** `k<鍵ID>.<iv>.<暗号文>`。平文は D1 に入らない（ADR-0001）。鍵の世代は封筒の `k<鍵ID>` で見分ける |
| body_format | text | `markdown`（将来 `plain` 等）。平文メタデータ |
| first_day | text | **積み上がる最初の「日」**（`YYYY-MM-DD`、日本時間）。**平文メタデータ ＝ 可視化・絞り込み・並びの軸**（[ADR-0005](adr/0005-post-axis-is-day-range.md)）。いま積んだ苔片は `dayKey(created_at)`、過去に積む苔片はリクエストの日 |
| last_day | text | **最後の「日」**。単日は `first_day` と同じ値（NULL にしない ＝ COALESCE 不要）。`first_day ≤ last_day ≤ 今日`。続く苔片（[CONTEXT.md](../CONTEXT.md)）は `first_day < last_day` |
| kind | text? | **向き**（[CONTEXT.md](../CONTEXT.md)）: `input` / `output` / `both`。null ＝ 未分類（既存行・付けなかった苔片）。平文メタデータ（総草の色相） |
| created_at | integer | epoch ms。**投稿した瞬間**（他テーブルと同じ意味）。時刻を持つ唯一の列で、§5 の時間帯分布の出どころ。画面が時刻を出すのは `first_day = last_day = dayKey(created_at)` の苔片だけ |
| updated_at | integer | |

> `deleted_at` は無い。[ADR-0003](adr/0003-post-delete-is-physical.md)（削除は物理削除）で書き手が消え、
> `0003_drop_post_deleted_at` が `DROP INDEX` → `ALTER TABLE ... DROP COLUMN` の 2 文で列ごと落とした
> （`CREATE TABLE` 無し ＝ `post` の再構築は起きていない）。

> ✅ **集計の「日」= `Asia/Tokyo` で切る**（2026-08-23）。2026-09-06 からは**書く側で切って `first_day` / `last_day` に保存する**
> （いま積む = コアの定数 `APP_TZ` を使う純粋関数 `dayKey(Date.now())`、過去に積む = リクエストの日を検証して保存）。
> 読む側は文字列比較だけで、読み時の TZ 変換は無い（[ADR-0005](adr/0005-post-axis-is-day-range.md)）。**`user` に TZ 列は持たない** ——
> 見る場所で過去のマスが動かないことを優先し、設定化が要るようになったら NULLABLE 列か API パラメータで足す
> （どちらもテーブル再構築を伴わない）。週の開始曜日も当面は日曜固定。

### tag
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK |
| user_id | text | FK → user |
| name | text | 表示名。最初に作られた表記をそのまま保つ（`TypeScript` と書いたなら以後もそう表示する） |
| norm | text | 正規化キー = `trim` ＋ NFKC ＋ 小文字化。**`(user_id, norm)` で一意**。`TypeScript` / `typescript` / ` typescript ` は同じ石に落ちる。`ＴＳ` → `ts` は別の石（別名は Phase 2 の `tag_alias`）。`COLLATE NOCASE` では ASCII の大小しか吸収できないのでアプリ層で正規化する。NOT NULL |
| color | text? | 苔の色（可視化） |
| emoji | text? | 任意 |
| description | text? | このタグの説明 |
| archived_at | integer? | アーカイブ |
| created_at | integer | |

### post_tags（多対多）
| カラム | 型 | 備考 |
| --- | --- | --- |
| post_id | text | FK → post |
| tag_id | text | FK → tag |
|  |  | PK = (post_id, tag_id) |

### tag_alias（表記ゆれ統合用・任意）
| カラム | 型 | 備考 |
| --- | --- | --- |
| alias | text | 別名（例: `TS`）。`(user_id, alias)` で一意、`tag.name` とも衝突させない |
| tag_id | text | 正規タグへの FK（例: `typescript`） |

### attachment（将来）
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text | PK |
| post_id | text | FK → post |
| kind | text | `image` 等 |
| url / blob_key | text | 保存先参照 |
| created_at | integer | |

## 集計（可視化用クエリの素）

これらは **メタデータ（first_day / last_day / kind, tag）だけ** で計算でき、本文暗号化と両立する。
軸は「日」の範囲（[ADR-0005](adr/0005-post-axis-is-day-range.md)、2026-09-06。A1 が着地するまでコードは `created_at` を
読み時に `dayKey()` で切っている）。期間はどこでも**重なり**で引く: `first_day <= to AND last_day >= from`。

- **総草 日次ヒートマップ**（ヒートマップはタグで分けない、[visualization.md](visualization.md) §1）:
  `post` を窓との重なりで絞って `first_day` / `last_day` / `kind` を取り（JOIN 不要＝タグ無しの苔片も入る）、
  コアの純粋関数で窓との交差の各日に +1（続く苔片は在った各日に数える）。日ごとに 入（`input` + `both`）と
  出（`output` + `both`）も数えて色相にする。「計 N 片」は窓に重なる苔片の数（マスの合計ではない）。
  読み時の TZ 変換は無い（SQLite の `date()` / `strftime()` は UTC 基準 —— そもそも日は書く側でしか切らない）。
- **タグのタイムライン（打ち込み期間）**: `post_tags` JOIN `post` を `tag_id` で GROUP BY し
  `MIN(first_day)` / `MAX(last_day)` / `COUNT(*)`（[visualization.md](visualization.md) §8）。
  - **組み合わせ行（タグ集合 AND、n ≧ 2）**: `pt.tag_id IN (:t1 … :tn)` で引き、post ごとに
    `HAVING COUNT(DISTINCT pt.tag_id) = n` で「全部付いた苔片」に絞り、外側で MIN/MAX/COUNT。
  - **フォーカス（1 タグで絞った共起タグ別の内訳）**: 共起クエリと同じ自己 JOIN を
    `a.tag_id = :focus` で絞って `b.tag_id` で GROUP BY し、各共起タグの MIN/MAX/COUNT を一括で取る。
  - **活動月（月セグメント棒）**: 同じ JOIN から `first_day` / `last_day` を取り、コアで最初の月〜最後の月を列挙して
    各月に +1（続く苔片は触れる各月に 1 → **`months` の和は `count` 以上**。単日だけなら等しい）。
    span の集計と同じ batch（＝同じスナップショット）で読む。
- **累積（積み上げ）**: 上記を日付昇順で累積和。
- **ストリーク**: タグ別に投稿のある日付集合を取り、連続日数を計算（純粋関数でやる）。
- **内訳**: 期間内のタグ別件数。向きの比率（吸う／出す）も同じ材料。
- **時間帯/曜日分布**: `created_at`（投稿した瞬間 —— 時刻を持つ唯一の列）から hour / weekday を取り集計。
- **タグ共起（タグ関係グラフ）**: `post_tags a JOIN post_tags b ON a.post_id = b.post_id AND a.tag_id < b.tag_id` を `(a.tag_id, b.tag_id)` で GROUP BY → 共起回数＝エッジの重み。ノードの大きさはタグ別件数（続く苔片も 1）。期間は重なりで絞る（`last_day >= 期間の初日`。去年始まって今年まで続く苔片は「今年」に入る — [visualization.md](visualization.md) §6）。

> パフォーマンス: 1ユーザーの個人日記規模なら素朴な集計で十分。必要になったら日次集計テーブル（マテビュー的な `daily_tag_count`）を足す。

## 最初のマイグレーション（`0001`）に入れる範囲

✅ **`drizzle/0001_kokemusu_schema.sql` として生成済み**（`user` / `credential` / `session` / `post` / `tag` / `post_tags` の 6 つ。
ローカル D1 に適用して検証済み。本番へは merge 時に Workers Builds の deploy command が当てる）。`api_token` は
✅ `0002_api_token.sql` でこの経路どおり追加済み（CREATE TABLE + index 2 本のみ）。`tag_alias`（Phase 2）・
`attachment`（Phase 4）は**葉テーブルなので後から追加しても既存テーブルを再構築しない** ＝ 必要になってから足す。
逆に **`user` / `post` / `tag` は CASCADE の親**なので、NOT NULL にしたい列は `0001` で決めきる（後から NOT NULL 列を
足す・型を変える・rename するとテーブル再構築 → 子行が消える。`cloudflare-d1-drizzle-migration`）。
NULLABLE 列の追加は安全。**列の drop も安全** ── SQLite は再構築せずその場で落とす（索引付きの列は落とせないので
`DROP INDEX` が先）。`0003` が `post.deleted_at` をそう消し、`post_tags` の行は 1 行も減っていない。

**`0004`（A1、予定）＝ `post` の唯一の再構築**（[ADR-0005](adr/0005-post-axis-is-day-range.md)）: `first_day` / `last_day`（NOT NULL）と
`kind`（NULLABLE、同乗）を足す。NOT NULL 追加は drizzle-kit が `__new_post` ＋ `DROP TABLE post` を生成し、D1 は
`PRAGMA foreign_keys=OFF` を無視するので **`post_tags` が cascade で消える** → migration の中で一時表に退避して復元し、
`cloudflare-d1-drizzle-migration` の runbook（事前 export・事後の `post` / `post_tags` 行数）を踏む。既存行の backfill は
`date((created_at + 32400000) / 1000, 'unixepoch')` の 1 回限り（Tokyo に DST が無いので正しい。恒常コードでは使わない）。

## インデックス（目安）

- `post(user_id, first_day, created_at)` ── 一覧の並び `(first_day DESC, created_at DESC, id DESC)`・期間絞り込み（重なりの片側）。
  ADR-0005。A1 までは `post(user_id, created_at)`。
- `post_tags(tag_id)` ── 多対多の逆方向（共起クエリもこれで足りる）。
  **`post_tags(post_id)` は張らない** ── PK `(post_id, tag_id)` が作る暗黙の index
  `sqlite_autoindex_post_tags_1` が `WHERE post_id = ?` を covering index で捌く（`0001` 適用後の
  `EXPLAIN QUERY PLAN` で確認済み）。明示的に張ると純粋な書き込みコスト増。
- `tag(user_id, norm)` UNIQUE ── 表記ゆれの吸収・重複防止・補完。
- `credential(user_id)` ── 端末一覧。
- `session(user_id)` / `session(expires_at)` ── 失効・期限切れ掃除。
- `api_token(token_hash)` UNIQUE ── 認証のホットパス（1 点読み）。
- `api_token(user_id, revoked_at)` ── 設定画面の一覧。
