# データモデル

SQLite / D1 前提。1インスタンス＝1ユーザーだが、認証情報のためにユーザーレコードは持つ。
本文とメタデータを分離できる設計にしておく（暗号化と可視化の両立 → [security.md](security.md)）。

2026-08-22 更新: 認証をパスキー single-user に確定（`password_hash` 廃止、`credential` / `session` を
`cloudflare-workers-passkey-auth` の形に合わせた）、API 自動投稿用の **`api_token`** と **`post.title`** を追加。

## 規約

- **id**: `text`、`crypto.randomUUID()`。例外は `credential.id`（WebAuthn の credential ID そのもの）。
- **日時**: `integer` の epoch ms で統一（passkey skill の ISO `TEXT` は苔むすでは epoch ms に読み替える。PAT skill は epoch ms）。
- **子テーブルは `user` に `ON DELETE CASCADE`**。⚠️ D1 は `PRAGMA foreign_keys=OFF` を無視するので、親テーブル（`user` / `post`）を**再構築する**マイグレ（NULL→NOT NULL、型変更、rename）は子行を cascade delete する罠（`cloudflare-d1-drizzle-migration`）。`user` の列は最初に決めきり、後から触らない。
- **本文と title は暗号文、それ以外は平文**（[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)）。暗号文は `k<鍵ID>.<iv>.<暗号文>` の封筒で、鍵 `BODY_KEY` は Worker Secret。集計・可視化は平文のメタデータだけで成立する。
- 純粋関数で扱える形を優先（ストリーク計算などは SQL でなく `packages/core` で）。

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
| title | text? | **任意の見出し**の暗号文（本文と同じ封筒・同じ鍵）。位置づけは未決（[roadmap.md](roadmap.md) 決めること 7）: API 自動投稿の機械的な見出し（例「mazuoboeru 2026-08-22」）専用か、手動投稿でも付けられるか |
| body | text | 本文（Markdown）の**暗号文** `k<鍵ID>.<iv>.<暗号文>`。平文は D1 に入らない（ADR-0001）。鍵の世代は封筒の `k<鍵ID>` で見分ける |
| body_format | text | `markdown`（将来 `plain` 等）。平文メタデータ |
| created_at | integer | epoch ms。**平文メタデータ**（可視化の軸） |
| updated_at | integer | |
| deleted_at | integer? | ソフトデリート（null=生存） |

> created_at はローカルタイムゾーンでの「その日」を集計に使うため、表示TZと集計TZの扱いを決めておく（設定の週開始曜日/TZ）。

### tag
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK |
| user_id | text | FK → user |
| name | text | 表示名。`(user_id, name)` で一意 |
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

これらは **メタデータ（created_at, tag）だけ** で計算でき、本文暗号化と両立する。

- **タグ別 日次ヒートマップ**:
  `post_tags` JOIN `post` を `tag_id` × `date(created_at)` で GROUP BY、件数を数える。
- **累積（積み上げ）**: 上記を日付昇順で累積和。
- **ストリーク**: タグ別に投稿のある日付集合を取り、連続日数を計算（純粋関数でやる）。
- **内訳**: 期間内のタグ別件数。
- **時間帯/曜日分布**: `created_at` から hour / weekday を取り集計。
- **タグ共起（タグ関係グラフ）**: `post_tags a JOIN post_tags b ON a.post_id = b.post_id AND a.tag_id < b.tag_id` を `(a.tag_id, b.tag_id)` で GROUP BY → 共起回数＝エッジの重み。ノードの大きさはタグ別件数。期間は `post.created_at` で絞る（[visualization.md](visualization.md) §6）。

> パフォーマンス: 1ユーザーの個人日記規模なら素朴な集計で十分。必要になったら日次集計テーブル（マテビュー的な `daily_tag_count`）を足す。

## インデックス（目安）

- `post(user_id, created_at)` ── タイムライン・期間絞り込み。
- `post(deleted_at)` ── 生存フィルタ。
- `post_tags(tag_id)` / `post_tags(post_id)` ── 多対多双方向（共起クエリもこれで足りる）。
- `tag(user_id, name)` UNIQUE ── 重複・補完。
- `credential(user_id)` ── 端末一覧。
- `session(user_id)` / `session(expires_at)` ── 失効・期限切れ掃除。
- `api_token(token_hash)` UNIQUE ── 認証のホットパス（1 点読み）。
- `api_token(user_id, revoked_at)` ── 設定画面の一覧。
