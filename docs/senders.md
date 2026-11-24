# 送り側向けの契約

苔むすの外のアプリ・CLI・エージェント・ページが苔片を届けるための、**送り側が読む唯一の入口**。
苔むすは送り側を知らない（[ADR-0002](adr/0002-api-posting-via-receiver-side-pat.md)）ので、送り側ごとの説明はここには無い。
**上限や鍵の正は生成物 [`senders/posts.schema.json`](senders/posts.schema.json)**（`createPostSchema` から `pnpm test` が生成・一致検査、
[ADR-0008](adr/0008-sender-contract-is-published-by-the-receiver.md)）。この文書はその読み方と、JSON Schema に書けない規則。

届け方は 2 つで、苔片の中身（body）の形はどちらも同じ:

| 届け方 | 誰が苔片を作るか | 要るもの | 節 |
| --- | --- | --- | --- |
| API で作る | 送り側（持ち主の代わりに） | 持ち主が発行した PAT | [前提: PAT](#前提-pat) ・ [契約: `POST /api/posts`](#契約-post-apiposts) |
| リンクで渡す | 持ち主（積むダイアログで「積む」を押す） | なし（持ち主の端末でリンクを開く） | [リンクで渡す](#リンクで渡す) |

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

## リンクで渡す

PAT を持てない送り側（公開の静的サイトなど）が、**積む前の苔片**を持ち主の積むダイアログに入れる入口
（[CONTEXT.md](../CONTEXT.md) の「渡す」、[ADR-0009](adr/0009-hand-over-by-link-fragment.md)）。苔片になるのは持ち主が
「積む」を押したときだけで、渡しただけでは何も保存されない。持ち主は一言を足したり、石や日を直したりしてから積める。

### 形

```text
https://kokemusu.shiraoka.workers.dev/積む#post=<encodeURIComponent(JSON.stringify(body))>
```

- `body` は **`POST /api/posts` の body そのもの**。キーも上限も [`senders/posts.schema.json`](senders/posts.schema.json) と
  上の「日の規則」のとおり（本文は必須）。
- `#` より後ろはブラウザがサーバーへ送らない。苔むすの Worker に届くのは `GET /積む` だけで、中身はログにも残らない
  （中身がサーバーへ届くのは、持ち主が積むを押した `POST /api/posts` のとき）。**query（`?post=`）にはしない。**
- `#` の中は `post=` 1 つだけ。ほかのキーや 2 つ目の `post` があると開かない。
- エンコードは `encodeURIComponent` か `URLSearchParams`（どちらも読める）。生の JSON を置くと、本文の `&` `#` `+` で壊れる。
- パスは `/%E7%A9%8D%E3%82%80`（percent-encoding）でもよい。`#` が無ければ、積むダイアログが持ち主の書きかけのまま開く。
- 持ち主がセルフホストした苔むすなら、ホスト名をその苔むすのものに替える。

```js
// 依存の無い送り側の例（静的サイトの JS）
const post = {
  body: "[ノートの題](https://example.com/notes/n.html)",
  tags: ["透き通る", "os"], // 出所の石と、中身の石
  kind: "input",
  firstDay: "2026-11-23", // 読んだ日（日本時間）。省略 ＝ 持ち主が積む日
};
const a = document.createElement("a");
a.href = "https://kokemusu.shiraoka.workers.dev/積む#post=" + encodeURIComponent(JSON.stringify(post));
a.rel = "noreferrer"; // 苔むすのログに送り側のオリジンも残さない
a.textContent = "苔むすに積む";
```

### 開かない条件

- **`POST /api/posts` が 400 にする body は、リンクでも開かない。** ダイアログは開かず、苔むすの画面に理由が出る
  （例「リンクで渡された苔片を開けませんでした: 知らない項目 source」）。読めない項目を黙って捨てて開くことはしない
  （[ADR-0006](adr/0006-no-post-title.md) と同じ）。
- 今日が要る規則だけは扱いが違う:
  - 今日より後の日・今日から 1200 か月より前の日は**開く**。積むを押したときに、ダイアログの日の欄が止める（持ち主が直せる）。
  - `lastDay` だけ（`firstDay` なし）は**開かない**。API では「今日〜`lastDay`」の意味になり、今日でなければ 400 になる形。
    範囲は `firstDay` と `lastDay` の両方で渡す。
- 持ち主の端末に、脇に置いた書きかけが 5 件あると開かない（何も消さない。画面にそう出る）。

### 持ち主の端末で起きること

- 書きかけ（積んでいない中身）があれば脇に置き、渡された苔片で開く。それを積むか「捨てる」と、書きかけが戻る。
- ログインしていなければ、ログイン画面に「ログインすると開きます」と出て、ログインの後に開く（中身は URL に残るだけ）。
- 開いたら URL は `/` に書き換わり、再読み込みしても二度は開かない。中身は持ち主の端末の閲覧履歴に残る。
  **センシティブなものをリンクに入れない。** リンクは持ち主の端末にだけ出す。

### 確かめ方（送り側）

- 組んだ URL を同じ手順で解き、元の body に戻ることを unit test で確かめる:
  `JSON.parse(new URLSearchParams(new URL(href).hash.slice(1)).get("post"))`。
- body は vendoring した `posts.schema.json` で検証する（上の「読み方」、`z.fromJSONSchema`）。依存を持たない送り側は、
  `properties` のキーの集合と `required`（`["body"]`）を手で突き合わせるだけでもよい（`additionalProperties: false` の
  drift を拾う）。
- 実地: 持ち主の端末でリンクを開き、ダイアログに入っていることを見て、「捨てる」で閉じる（「閉じる」だと書きかけとして残る）。

## 送り側の作法（推奨）

1. 出所は `tags` で名乗る（例 `["mazuoboeru"]`、`["透き通る"]`）。受け側に送り側の欄は無い。
2. 「その日の分」は `firstDay` にその日を入れる。活動ゼロの日は送らない（空の石を積まない）。
3. 投稿を組む関数は純粋に、送る関数は throw しない境界に（okayus-skills `cloudflare-cron-to-discord` の形）。
4. schema.json を vendoring して契約テストを持つ（上記「読み方」）。

## 公開されている送り側（受け側の保守用。実行時には知らない）

wire を変える PR は、ここに挙げた実装を raw GitHub で読んで影響を確かめる（ADR-0008）。

- mazuoboeru — 日次ダイジェスト（API で作る）: `apps/web/worker/domain/kokemusu-post.ts`（[raw](https://raw.githubusercontent.com/okayus/mazuoboeru/main/apps/web/worker/domain/kokemusu-post.ts)）、ADR-0017
- 透き通る — 読んだノート（リンクで渡す）: [okayus/sukitooru](https://github.com/okayus/sukitooru)。導線は 2026-11-24 から作る（実装の場所が決まったらここに足す）

## 受け側の保守: wire を変えるとき

1. `createPostSchema` を変える → `pnpm test` が `senders-contract.test.ts` で落ちる（リンクの読み手 `src/handover.ts` が
   同じ body に同じ答えを返すかの表も同じファイルにある。規則を変えたら両方を直す）。
2. `pnpm --filter @kokemusu/web exec vitest run -u worker/senders-contract.test.ts` で `senders/posts.schema.json` を再生成
   （新しいキーは `FIELD_DOCS` に説明が無いと `tsc` が落ちる）。
3. この文書の該当節と下の変更履歴に 1 行足す。上の送り側一覧を確認する。

## 変更履歴（wire）

- 2026-11-24 届け方「リンクで渡す」（`/積む#post=<JSON>`）を追加。body の形は `POST /api/posts` と同じで、API は不変（ADR-0009）。
- 2026-09-11 `tags` の上限を 20 → **99 個**に（D1 の bound parameter 100 − タグ解決の `user_id` 1 個。#57）。他は不変。
- 2026-09-09 `thickness` を追加（続く苔片に必須、単日に不可 — ADR-0007、#55）。この文書と schema.json を公開（ADR-0008）。
- 2026-09-06 `title` を廃止、知らないキーは 400（ADR-0006、#49）。`firstDay` / `lastDay` / `kind` を追加（ADR-0005、#46 #47）。
- 2026-09-03 `POST /api/posts` を PAT（`post:write`）で開放（ADR-0002）。
