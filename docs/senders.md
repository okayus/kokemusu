# 送り側向けの契約（API 自動投稿）

別のアプリ・CLI・エージェントが持ち主の代わりに苔片を作るための、**送り側が読む唯一の入口**。
苔むすは送り側を知らない（[ADR-0002](adr/0002-api-posting-via-receiver-side-pat.md)）ので、送り側ごとの説明はここには無い。
**上限や鍵の正は生成物 [`senders/posts.schema.json`](senders/posts.schema.json)**（`createPostSchema` から `pnpm test` が生成・一致検査、
[ADR-0008](adr/0008-sender-contract-is-published-by-the-receiver.md)）。この文書はその読み方と、JSON Schema に書けない規則。

## 読み方（送り側のサンドボックスから）

苔むすのリポは public。送り側のコンテナは egress firewall の中でも GitHub の IP レンジに届く（`raw.githubusercontent.com` は
GitHub meta の `web` レンジ、2026-09-09 に mazuoboeru-dev / matatabetai-dev から 200 を実測）。

```sh
curl -fsSL https://raw.githubusercontent.com/okayus/kokemusu/main/docs/senders.md
curl -fsSL https://raw.githubusercontent.com/okayus/kokemusu/main/docs/senders/posts.schema.json
```

- **schema.json を自分のリポに vendoring し、投稿を組む関数の出力を `z.fromJSONSchema(schema)` で検証する unit test を置く**
  （zod 4.1 以上。ajv は要らない）。更新は同じ `curl` で差し替える。
- **ADR や skill に上限・キー名を転記しない。** 転記した契約は 3 日で古くなった（ADR-0008）。書くなら「この文書を読む」だけ。
- リポ全体が要るなら `git clone --depth 1 https://github.com/okayus/kokemusu.git`（GitHub の `git` レンジも届く）。

## 前提: PAT

- 持ち主が苔むすの設定画面で発行する（名前 ＝ 送り側の名前。生の token は**一度だけ**表示）。スコープは `post:write` のみ。
- 送り側が Worker なら token は Worker Secret（例 `KOKEMUSU_PAT`）、URL は `vars`（例 `KOKEMUSU_URL`、秘密ではない）。
  CLI なら env。argv・ログ・URL に token を出さない。
- 失効は設定画面から。失効・期限切れ・不明な token はどれも `401 unauthorized`（区別は設定画面の一覧で）。
- smoke: `curl -s "$KOKEMUSU_URL/api/auth/me" -H "Authorization: Bearer $KOKEMUSU_PAT"` → `{ "id", "displayName" }`。
  PAT で届く route は **`POST /api/posts` と `GET /api/auth/me` だけ**。他は `403 session_required`（token が漏れても日記は読めない）。

## 契約: `POST /api/posts`

```sh
curl -s -X POST "$KOKEMUSU_URL/api/posts" \
  -H "Authorization: Bearer $KOKEMUSU_PAT" -H "Content-Type: application/json" \
  -d '{"body":"- 回答: 12問（正答 9・75%）","tags":["mazuoboeru"],"firstDay":"2026-09-08"}'
```

- `Origin` は要らない（Bearer は CSRF の Origin 検査を免除）。Cookie は送らない。
- body は `schema.json` のとおり。**`additionalProperties: false` ＝ 知らないキーは `400 validation_error`**（黙って捨てない）。
  必須は `body` だけ。`tags` / `kind` / `firstDay` / `lastDay` / `thickness` は任意。
- 応答 `201`: `{ id, body, bodyFormat, createdAt, updatedAt, firstDay, lastDay, thickness, postedDay, kind, tags: [{ id, name }] }`。
  `body` は送った平文がそのまま返る（保存は暗号文）。`postedDay` は送った日（日本時間）。送り側はこの応答をログに出さない。

### 日の規則（JSON Schema に書けない部分。[ADR-0005](adr/0005-post-axis-is-day-range.md) / [ADR-0007](adr/0007-spanning-post-amount-is-days-times-thickness.md)）

- 「日」は**日本時間**の暦日 `YYYY-MM-DD`。受け側の「今日」も日本時間。
- `firstDay` 省略 ＝ 今日、`lastDay` 省略 ＝ `firstDay`。`firstDay ≤ lastDay ≤ 今日`、かつ今日から 1200 か月以内。外れると 400。
- **前日分を翌日に送る送り側は `firstDay` に前日を入れる**（苔片は送った日ではなく、在った日に積まれる）。
- `firstDay = lastDay`（単日）に `thickness` は付けられない。`firstDay < lastDay`（続く苔片）には `thickness`（1〜100）が必須。
  `null` は「無し」。どちらも破ると 400。
- `tags` は正規化（trim ＋ NFKC ＋ 小文字）で同じ石に落ちる。`"TypeScript"` と `"typescript"` は同じ石、`"ＴＳ"` は `"ts"` になる。

### エラー（すべて `{ "error": { "type", "message"? } }`）

| status | type | 意味 |
| --- | --- | --- |
| 400 | `validation_error` | body が schema / 日の規則に合わない（知らないキーを含む） |
| 401 | `unauthorized` | token が無い・不明・失効・期限切れ |
| 403 | `insufficient_scope` | token に `post:write` が無い |
| 403 | `session_required` | PAT では届かない route |
| 429 | `rate_limited` | IP ごと **120 req / 60 s**（`/api/*` の PAT 面。ログイン用とは別枠） |
| 503 | `encryption_not_configured` | 受け側の `BODY_KEY` 未設定（人手待ち。リトライしても変わらない） |

- **`Idempotency-Key` は無い**（必要になってから — ADR-0002）。**リトライは二重投稿になり得る**ので、失敗した分は欠けたままにして
  次の分を送る（mazuoboeru ADR-0017 の判断）。
- 苔むすが落ちていても送り側の cron を道連れにしない: 境界は throw せず、HTTP status だけログする（token・body・応答は出さない）。

## 送り側の作法（推奨）

1. 出所は `tags` で名乗る（例 `["mazuoboeru"]`）。受け側に送り側の欄は無い。
2. 「その日の分」は `firstDay` にその日を入れる。活動ゼロの日は送らない（空の石を積まない）。
3. 投稿を組む関数は純粋に、送る関数は throw しない境界に（okayus-skills `cloudflare-cron-to-discord` の形）。
4. schema.json を vendoring して契約テストを持つ（上記「読み方」）。

## 公開されている送り側（受け側の保守用。実行時には知らない）

wire を変える PR は、ここに挙げた実装を raw GitHub で読んで影響を確かめる（ADR-0008）。

- mazuoboeru — 日次ダイジェスト: `apps/web/worker/domain/kokemusu-post.ts`（[raw](https://raw.githubusercontent.com/okayus/mazuoboeru/main/apps/web/worker/domain/kokemusu-post.ts)）、ADR-0017

## 受け側の保守: wire を変えるとき

1. `createPostSchema` を変える → `pnpm test` が `senders-contract.test.ts` で落ちる。
2. `pnpm --filter @kokemusu/web exec vitest run -u worker/senders-contract.test.ts` で `senders/posts.schema.json` を再生成
   （新しいキーは `FIELD_DOCS` に説明が無いと `tsc` が落ちる）。
3. この文書の該当節と下の変更履歴に 1 行足す。上の送り側一覧を確認する。

## 変更履歴（wire）

- 2026-09-09 `thickness` を追加（続く苔片に必須、単日に不可 — ADR-0007、#55）。この文書と schema.json を公開（ADR-0008）。
- 2026-09-06 `title` を廃止、知らないキーは 400（ADR-0006、#49）。`firstDay` / `lastDay` / `kind` を追加（ADR-0005、#46 #47）。
- 2026-09-03 `POST /api/posts` を PAT（`post:write`）で開放（ADR-0002）。
