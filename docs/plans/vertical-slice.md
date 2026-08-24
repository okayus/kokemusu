# 縦切り: 投稿 → タグ → ヒートマップに 1 マス点く

Phase 1 MVP の最初の縦切り。**完了したらこのファイルは削除する**（CLAUDE.md の plans 運用）。
恒久的な決定はここではなく [data-model.md](../data-model.md) / [CONTEXT.md](../../CONTEXT.md) /
[roadmap.md](../roadmap.md)「決めること」/ [adr/](../adr/) に書き戻し済み。

## ゴールと完了判定（DoD）

本番 `https://kokemusu.shiraoka.workers.dev` で、この 5 つが全部通ったら縦切り完了。

1. 自分のパスキーでログインできる。ログアウト状態では API が `401`、登録は `403 registration_closed`。
2. 1 欄のフォームに書き、`typescript` タグを付けて投稿できる（`⌘/Ctrl+Enter`）。
3. タイムラインに、いま書いた苔片が出る。
4. `typescript の苔` のヒートマップで **今日のマスが 1 段濃くなる**。
5. `wrangler d1 execute kokemusu-db --remote --command "SELECT body FROM post LIMIT 1"` が
   封筒（`k1.<iv>.<暗号文>`）を返す＝**平文の本文が D1 に 1 行も無い**（[ADR-0001](../adr/0001-body-encrypted-at-app-layer.md)）。

```
[SPA 1 欄フォーム] --POST /api/posts--> [Hono] --暗号化--> [D1: post]
                                          |                    |
                                          +--正規化 upsert-->  [tag / post_tags]
                                                               |
[ヒートマップ SVG] <--GET /api/stats/heatmap-- [dayKey で日別集計（平文メタデータのみ）]
```

## この縦切りで確定した設計（2026-08-23 の grill）

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| 認証の位置 | **パスキーを先に**（PR2）。投稿 API より前 | `main` への merge = 即本番公開。書き込み口が無防備な瞬間を作らない（preview 環境は無く、ブランチ push では Workers Builds は動かない＝段階公開の余地が無い） |
| ヒートマップの「その日」 | **`Asia/Tokyo` 定数**でバケット化。`user` に TZ 列を持たない | 見る場所で過去のマスが動かない。設定化は後から NULLABLE 列 / API パラメータのどちらでも足せる（＝テーブル再構築なし） |
| タグの表記ゆれ | `tag.norm`（`trim + NFKC + toLowerCase`）を **NOT NULL** で持ち、`UNIQUE(user_id, norm)` | `COLLATE NOCASE` は ASCII の大小しか吸収せず `ＴＳ` を取りこぼす。NOT NULL 列は後付けが危険（下記の D1 罠）なので 0001 で入れる |
| UI トーン（決めること 4） | **ミニマル + 苔の言葉と色**。用語（苔片）・空状態のコピー・苔の配色トークン（ライト/ダーク）まで。動きは「投稿後にマスが濃くなる」1 箇所 | 世界観の主役 = 苔の庭ビューは Phase 4。MVP は摩擦ゼロを優先 |

## 横断ルール

- **マイグレーションは additive のみ**（新テーブル / NULLABLE 列 / INDEX）。既存テーブルの列制約変更・型変更・rename は
  テーブル再構築 → `DROP TABLE` → 子行が CASCADE 削除、という D1 固有の罠（skill `cloudflare-d1-drizzle-migration`。
  `PRAGMA foreign_keys=OFF` を D1 は無視する）。**CASCADE の親になる `user` / `post` / `tag` の NOT NULL 列は 0001 で決めきる。**
- 1 PR = CI green（`pnpm -r run check` / `build` / `test`）。**merge = 即本番**なので、merge して困る状態を PR に入れない。
- Secret はホストで `wrangler secret put`（コンテナは Cloudflare 資格情報を持たない）。ローカルは `apps/web/.dev.vars`。
- UI を書く前に skill `modern-web-guidance` を読む（CLAUDE.md 規約）。可視化は自作 SVG。
- ドメインロジックは純粋関数。置き場所は **`apps/web/worker/core/`**（`packages/core` はまだ切らない —
  集計はサーバ側で完結し SPA は描画専任なので、共有する相手がまだ居ない）。

## PR の並び

### PR1 — スキーマ + Drizzle 配線（ルート無し） ✅ merged (#11, 2026-08-24)

- 依存追加: `drizzle-orm` / `drizzle-kit`（`drizzle-kit generate` は資格情報不要＝サンドボックスで走る。
  `push` / `migrate` / `studio` は使わない ＝ 本番適用は wrangler 側に任せる）。
- `apps/web/worker/db/schema.ts`（Drizzle スキーマ）+ `drizzle.config.ts`（`dialect: "sqlite"`, `out: "./drizzle"`）。
- テーブル: **`user` / `credential` / `session` / `post` / `tag` / `post_tags`**（列は [data-model.md](../data-model.md) 準拠。
  skill 側の複数形 `users/credentials/sessions` は苔むすでは単数形、日時は epoch ms `integer`）。
  `api_token`（Phase 2）・`tag_alias`（Phase 2）・`attachment`（Phase 4）は**葉テーブルなので後から追加しても安全**＝入れない。
- INDEX: `post(user_id, created_at)` / `post(deleted_at)` / `post_tags(tag_id)` /
  `tag(user_id, norm)` UNIQUE / `credential(user_id)` / `session(user_id)` / `session(expires_at)`。
  当初挙げていた `post_tags(post_id)` は**張らない** —— PK `(post_id, tag_id)` の暗黙 index が
  `WHERE post_id = ?` を covering index で捌く（[data-model.md](../data-model.md) のインデックス節）。
- ✅ **出力レイアウトは flat**（`drizzle/0001_kokemusu_schema.sql` + `drizzle/meta/`）＝ `migrations_pattern` は不要、
  `migrations_dir: "drizzle"` のままでよい。wrangler は `meta/*.json` をマイグレーションとして拾わない。
  連番は既存の `0000_init.sql` とぶつかった（drizzle は journal が空なら `0000` から振る）ので、生成物を `0001` に
  ずらし、journal に `0000_init` を、`meta/0000_snapshot.json` に空スナップショットを後追いで登録した。
  スナップショットは `id` / `prevId` の連結リストなので、2 つが同じ親を指すと `drizzle-kit check` が
  collision として弾く（実際に弾かれた）。現在は `check` が green、再 `generate` が no-op ＝ 次は `0002` が出る。
- ✅ 検証済み: `pnpm db:migrate` 後に `migrations list --local` が**未適用 0 件**、生成 SQL に `DROP TABLE` / `__new_` /
  `PRAGMA foreign_keys=OFF` が**無い**（`worker/db/migrations.test.ts` が CI で毎回見張る）。
  ローカル D1 で cascade（`DELETE FROM user` → 子行全滅）・`tag.norm` の NOT NULL・`(user_id, norm)` UNIQUE・
  `body_format` の既定値 `markdown` も実挙動を確認。

### PR2 — パスキー認証 + セキュリティヘッダ（skill `cloudflare-workers-passkey-auth` の single-user 変種）

> ⚠️ **この PR で初回登録をした瞬間、`RP_ID = kokemusu.shiraoka.workers.dev` が永久に確定する。**
> 独自ドメインに移る可能性が少しでもあるなら、**登録より前に**移すこと（後からでは全パスキーが無効）。

- `@simplewebauthn/server` v13。route: `POST /api/auth/register/begin|verify`（public + レート制限。
  `INITIAL_REGISTRATION_TOKEN` 不一致 / 未設定は `403 registration_closed`）、`POST /api/auth/login/begin|verify`（public）、
  `POST /api/auth/logout`、`GET /api/auth/me`、`GET /api/auth/credentials`、`POST /api/auth/credentials/add/begin|verify`、
  `DELETE /api/auth/credentials/:id`（最後の 1 本は `400 last_credential`）。
- challenge は **D1 に持たず**署名付き 5 分 cookie（verify で読んで即削除）。セッションは `session` 行に裏打ちした HS256 JWT、
  cookie は `__Host-session`（`HttpOnly` / `Secure` / `SameSite=Lax` / `Path=/` / **`Domain` なし** — 兄弟 Worker に漏らさない）。
- **Hono の mount 順トラップ**: public な `/api/auth/*` を `sessionMiddleware` 付き protected app より**先に**登録する。
- ログインは username-less（`residentKey: "required"` / `allowCredentials` 無し）。カウンタ退行チェックは `stored !== 0` のときだけ
  （同期パスキーは常に 0 = iPhone が全部締め出される事故）。
- CSRF: `/api/*` の非 GET は `Origin === ORIGIN`（`403 csrf_origin_mismatch`）。
- `secureHeaders` + CSP。**`vite dev` の HMR インライン preamble と衝突する**（skill `cloudflare-workers-e2e-playwright`）ので
  dev と本番で分ける。レート制限は `ratelimits` binding（skill `cloudflare-workers-bot-scan-defense`）。
- **single-user 固有の要件**: `register/verify` は **`user` 行が既にあるなら新しい user を作らず、その行に `credential` を足す**
  （`INITIAL_REGISTRATION_TOKEN` が一致する場合のみ）。skill の既定は「初期トークンの再発行 = 新しい owner user」だが、
  苔むすは 1 人 1 インスタンスで `post` が `user_id` に紐づくため、新 user を作ると**過去の苔片が全部孤児になる**。
  この 1 行が「全パスキー紛失からの復帰」と「将来 RP_ID を変えたくなったときの再登録」の両方を安くする。
- 人手（ホスト）: `SESSION_SECRET` と `INITIAL_REGISTRATION_TOKEN` を `wrangler secret put` →
  **端末 2 台**登録 → `wrangler secret delete INITIAL_REGISTRATION_TOKEN` で閉じる。
- 検証: 本番でログイン / ログアウト、未認証で `GET /api/auth/me` が 401、`register/begin` が 403。

### PR3 — 本文暗号化コア（[ADR-0001](../adr/0001-body-encrypted-at-app-layer.md)。**最初の実データより前**）

- `apps/web/worker/core/crypto.ts`: AES-GCM 256、iv 12 バイト乱数、封筒 `k1.<iv(base64url)>.<暗号文(base64url)>`。
  `encryptBody(plain, key)` / `decryptBody(envelope, key)` の純粋関数（鍵は引数で受ける＝ I/O は境界に押し出す）。
- 鍵 `BODY_KEY` は Worker Secret。ホストで `openssl rand -base64 32 | wrangler secret put BODY_KEY` し、
  **同じ値を 1Password に**（失うと本文は永久に復号不能）。ローカルは `.dev.vars` に別値、`.dev.vars.example` に鍵名を追記。
- テスト: 往復・毎回 iv が変わる・別鍵では失敗・封筒の形・鍵 ID の取り出し。
- ログに平文・鍵・封筒を出さない。

### PR4 — 投稿 API + 最小タイムライン

- `POST /api/posts`（セッション必須）: Zod で `{ body: 1..N 文字, tags?: string[], title?: string }`。
  タグは `normalizeTagName`（`apps/web/worker/core/tag.ts`、`trim + NFKC + toLowerCase`）→ `(user_id, norm)` で引き、
  無ければ作成 → `post` + `post_tags` を **1 回の `db.batch`** で。本文と見出しは保存直前に暗号化。
- `GET /api/posts?limit=&cursor=&tag=`（セッション必須）: `deleted_at IS NULL`、新着順、復号して返す。
- UI（`modern-web-guidance` を読んでから）: `<form>` + `<textarea>` 1 欄 + タグ入力（既存タグは `<datalist>` で補完）、
  `⌘/Ctrl+Enter` で送信、送信中は `disabled`、失敗時は入力を消さない（localStorage 退避）。
- **本文はプレーンテキストで描画**（React の既定エスケープ）。Markdown + DOMPurify は縦切りの外（XSS 面を持ち込まない）。
- 検証: 本番で 1 件投稿 → タイムラインに出る → D1 の `body` が封筒（DoD 5）。

### PR5 — ヒートマップ集計 + 自作 SVG ← ここで 1 マス点く

- `apps/web/worker/core/day.ts`: `APP_TZ = "Asia/Tokyo"`、`dayKey(epochMs, tz = APP_TZ): "YYYY-MM-DD"`（`Intl` 使用）、
  `bucketByDay(rows, tz)`。全部純粋関数＝ Node の vitest でテスト（境界: 00:00 / 08:59 / 23:59、うるう年、月跨ぎ）。
- `GET /api/stats/heatmap?tag=&from=&to=`: `post ⋈ post_tags` を期間で絞って `created_at, tag_id` だけ取り、
  `bucketByDay` で日別件数に畳む（**本文に触らない** = 暗号化と両立）。
  規模が問題になったら日次集計テーブルを足す、と決めておく（個人日記の規模では素朴な集計で十分）。
- SVG: 週 = 列 / 曜日 = 行の格子、濃淡 5 段（深緑〜黄緑の苔グラデ、ライト/ダーク両対応の CSS カスタムプロパティ）。
  タグごとに 1 枚 + 総草。マスに `<title>` で「8/23 · 2 件」。週の開始は日曜固定（設定は後）。
- 検証: 本番で投稿 → **今日のマスが 1 段濃くなる**（DoD 4）。

### PR6 — e2e（skill `cloudflare-workers-e2e-playwright` + `playwright-e2e-in-docker-sandbox`）

- 3 spec だけ: ゴールデンパス（登録 → 投稿 → マスが点く）／認証境界（未認証で 401）／セキュリティヘッダ。
- WebAuthn 仮想 authenticator（CDP）。`DEV_BYPASS_USER_ID` に頼らない。
- ビルド成果物に対して `wrangler dev --persist-to .wrangler/state --ip 127.0.0.1`（`localhost` バインドは固まる）。
  e2e 用 config から `ratelimits` binding を外す（資格情報なしのサンドボックスでハングする）。
- Chromium はイメージに焼く＝ `.docker/Dockerfile` 変更 → **ホストでサンドボックス再ビルド**（人手）。

## この縦切りでやらないこと

Markdown レンダリング / 全文検索 / 投稿の編集・削除 UI（`deleted_at` 列だけ用意）／ PAT（Phase 2）／
累積グラフ・ストリーク・タグ関係グラフ／タグ運用（リネーム・統合・別名・色）／設定画面／エクスポート。

## 着手前に人手で確認すること（ホスト側）

1. ~~**本番マイグレーションの適用経路**~~ → ✅ **deploy command が当てている**（2026-08-24、PR #11 で実証）。
   `0001_kokemusu_schema.sql` を merge した直後、ホストの `wrangler d1 migrations list kokemusu-db --remote` が
   「No migrations to apply!」。**PR2 以降は merge するだけでスキーマが追随する** ——
   マイグレを含む PR に人手の手順を足さなくてよい（[dev-environment.md](../dev-environment.md) §3(a) に恒久記録）。
2. ~~独自ドメインの最終判断~~ → ✅ **`RP_ID = kokemusu.shiraoka.workers.dev` を永久固定でよい**（2026-08-23）。
   将来 custom domain を取っても**ログインの origin は `workers.dev` のまま**（RP_ID は origin の登録可能サフィックスで
   なければならず、`kokemusu.example.com` では既存パスキーが使えない）。移りたくなったときの逃げ道は下の PR2 の要件を参照。
3. コンテナの `GH_TOKEN`（`./up.sh` で起動しないと push / PR ができない）。

## リスク

| リスク | 対応 |
| --- | --- |
| ~~本番マイグレが自動で当たらず 500~~ | ✅ 解消（2026-08-24）。deploy command の migrate が当たることを PR #11 の merge で実証 |
| RP_ID ロックが PR2 で発効 | 事前確認 2。`wrangler.jsonc` の `RP_ID` / `ORIGIN` への diff は PR 自動 reject |
| CSP が `vite dev` の HMR を壊す | dev と本番で CSP を分ける。e2e はビルド成果物に対して `wrangler dev` |
| `BODY_KEY` 紛失 = 本文が永久に読めない | `wrangler secret put` と同時に 1Password。PR3 のチェックリストに入れる |
| 将来 `user` / `post` / `tag` の列を変えたくなる | 0001 で NOT NULL を決めきる。足すときは NULLABLE で足す。やむを得ず再構築するなら skill の runbook（バックアップ → 行数照合） |
