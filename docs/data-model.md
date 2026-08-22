# データモデル

SQLite / D1 前提。1インスタンス＝1ユーザーだが、認証情報のためにユーザーレコードは持つ。
本文とメタデータを分離できる設計にしておく（暗号化と可視化の両立 → [security.md](security.md)）。

## エンティティ概観

```
user 1───* credential        (WebAuthn パスキー)
user 1───* session
user 1───* post
post *───* tag   (post_tags 中間テーブル)
post 1───* attachment        (将来)
```

## テーブル定義（案）

### user
唯一の利用者。

| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK |
| display_name | text | 任意 |
| password_hash | text? | パスワード併用時のみ（Argon2id）。パスキーのみなら null |
| created_at | integer | epoch ms |

### credential（WebAuthn パスキー）
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text | PK（credential ID） |
| user_id | text | FK → user |
| public_key | blob | |
| counter | integer | リプレイ対策 |
| transports | text | JSON |
| label | text | 「MacBook」「iPhone」等 |
| created_at | integer | |

### session
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text | PK（ランダム）。Cookie に格納 |
| user_id | text | FK → user |
| expires_at | integer | |
| created_at | integer | |
| last_seen_at | integer | アイドルタイムアウト用 |

### post（苔片）
| カラム | 型 | 備考 |
| --- | --- | --- |
| id | text (uuid) | PK |
| user_id | text | FK → user |
| body | text | 本文（Markdown）。暗号化する場合はここを暗号文に |
| body_format | text | `markdown`（将来 `plain` 等） |
| is_encrypted | integer (bool) | 本文が暗号化済みか |
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
| alias | text | 別名（例: `TS`） |
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

> パフォーマンス: 1ユーザーの個人日記規模なら素朴な集計で十分。必要になったら日次集計テーブル（マテビュー的な `daily_tag_count`）を足す。

## インデックス（目安）

- `post(user_id, created_at)` ── タイムライン・期間絞り込み。
- `post(deleted_at)` ── 生存フィルタ。
- `post_tags(tag_id)` / `post_tags(post_id)` ── 多対多双方向。
- `tag(user_id, name)` UNIQUE ── 重複・補完。
- `session(expires_at)` ── 期限切れ掃除。
