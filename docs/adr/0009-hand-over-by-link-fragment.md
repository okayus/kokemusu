---
status: accepted
date: 2026-11-24
---

# 外のページは積む前の苔片を URL の fragment で渡し、積むのは持ち主

透き通る（tech ニュースのノートと学習教材の静的サイト、okayus/sukitooru）から、読んだノートを苔むすに積みたいという依頼が
来た。外から苔片を作る道は PAT による `POST /api/posts` だけで（[ADR-0002](0002-api-posting-via-receiver-side-pat.md)）、
公開の静的サイトには PAT を置けず、ほかのオリジンのブラウザからは呼べない（CORS の preflight に答えない）。しかも欲しいのは
自動投稿ではなく、読んだ持ち主が一言を足してから積むことだった。

**決定**: 送り側（[CONTEXT.md](../../CONTEXT.md)）は `https://<苔むす>/積む#post=<POST /api/posts の body を JSON にして
encodeURIComponent したもの>` へリンクする。SPA が fragment を読み、API と同じ規則で検証して、積むダイアログに書きかけとして
入れる（**渡す**）。苔片になるのは持ち主が「積む」を押したときだけで、本文がサーバーへ届くのもそのときが初め
（いつものセッションの `POST /api/posts`）。

- **fragment に入れる**: `#` より後ろはブラウザがサーバーへ送らない（Referer にも載らない）。Worker が見るのは `GET /積む`
  だけで、Workers Logs（`head_sampling_rate: 1`。query は既定で伏せない）に本文が平文で残らない。本文を読めるのは Worker
  だけという [ADR-0001](0001-body-encrypted-at-app-layer.md) の外に平文を出さない。
- **中身は API の body そのもの**: キーも上限も `createPostSchema` と同じで、契約は
  [ADR-0008](0008-sender-contract-is-published-by-the-receiver.md) の生成物 `posts.schema.json` をそのまま使う。API が 400 に
  する body はリンクでも開かず、理由を画面に出す（[ADR-0006](0006-no-post-title.md) の「黙って捨てない」）。今日が要る規則
  （未来の日・1200 か月の床）だけはダイアログの日の欄が積むときに止め、`lastDay` だけ（API では「今日〜lastDay」で、今日が
  要る）は API より厳しく断る。
- **書きかけは消さない**: 書きかけがあれば脇に置き（5 件まで重なる。超えたら開かない）、渡された苔片を積むか捨てると戻る。
- **ログインを越える**: 未ログインなら fragment を URL に残したままログイン画面に「ログインすると開きます」と出し、ログイン
  （パスキーはページを離れない）の後に開く。端末のストレージには入れない。
- 苔むすは送り側を知らないまま。出所は石で名乗り（例「透き通る」）、渡し方の契約は `docs/senders.md`「リンクで渡す」。

## Considered options

- **query（`/積む?post=…`）**: 本文がサーバーに届き、Workers Logs の URL に平文で残る。`redactQueryString` で伏せても、
  Worker が受け取ることは変わらない。
- **送り側の POST フォーム**: サーバーを通る。CSRF の Origin 検査が 403 にし、それを開ければ「ほかのオリジンが持ち主の
  セッションで書き込める」入口になる。
- **CORS を開けて PAT で `POST /api/posts`**: PAT を公開の静的サイトに置けない。持ち主が積むを押す場面も無い。
- **Web Share Target**: インストールした PWA が要り、iPhone の Safari は対応しない。リンク 1 本で済まない。
- **`postMessage`（苔むすを開き、送り側が中身を送る）**: 両側に受け渡しのコードが要り、苔むすの COOP（`same-origin`）が
  opener を切る。
- **読めない項目だけ外して開く（寛容）**: その場で積めるが、送り側が直さないまま石の欠けた苔片が積まれ続けうる
  （2026-11-24 の grill で不採用）。

## Consequences

- server の route は増えない。`/積む` は SPA fallback に落ちる 1 パスで、公開面も増えない（security-headers の e2e に足した）。
- 渡された中身は、持ち主の端末の閲覧履歴と書きかけ（localStorage）に平文で残る。書きかけと同じ信頼境界で、ログアウトで
  書きかけも脇も消える。送り側はセンシティブなものをリンクに入れない（`docs/senders.md`）。
- 規則は SPA（`src/handover.ts`）にもう一度書かれる（SPA は Worker のモジュールを import しない）。
  `worker/senders-contract.test.ts` が同じ body の表で `createPostSchema` ＋ `parseStacking` と答えが揃うことを検査するので、
  `createPostSchema` を変える PR はリンクの読み手も直すまで落ちる。
- ほかのページも `/積む#post=…` へ飛ばせるが、できるのはダイアログに中身を入れるところまで。積むのは持ち主の押下だけで、
  書きかけは脇に置かれるだけで消えない。
