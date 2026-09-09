---
status: accepted
date: 2026-09-09
---

# 送り側が読む契約は受け側が公開し、コードから生成する（転記しない）

送り側（[CONTEXT.md](../../CONTEXT.md)）は別のリポジトリ・別のサンドボックスで書かれ、苔むすのコードもドキュメントも
見えない。最初の送り側 mazuoboeru は、苔むす側セッションの grill で聞いた契約を自分の ADR-0017 に**人手で転記**して
実装した（2026-09-03、`{body, title?, tags}`）。3 日後の [ADR-0006](0006-no-post-title.md) で `title` が消え、知らないキーは
400 になった。mazuoboeru は 2026-09-05 に本番へ載り、以後**活動のあった日は毎晩 400** で石が積まれていない。送り側の境界は
status しかログせず、両側の unit test は矛盾する契約をそれぞれ固定して両方 green だった。苔むす側も「送っていたら外す」と
書くことしかできなかった（相手のコードが見えない）。

一方で、送り側のサンドボックスは苔むすの public リポを**既に読める**（2026-09-09 実測: mazuoboeru-dev / matatabetai-dev から
`raw.githubusercontent.com` は 200。GitHub の `web` IP レンジ `185.199.108.0/22` が firewall の ipset に入っているため。
本番ホストにも届くが、それは自分の本番ホストと Cloudflare の anycast IP を共有する偶然）。足りないのは経路ではなく、
**送り側向けの一枚の文書**と、**それがコードと一致し続ける仕組み**だった。

**決定**: 苔むすは送り側が読む契約を `docs/senders.md`（唯一の入口）と `docs/senders/posts.schema.json` として公開する。
schema.json は `createPostSchema`（`apps/web/worker/routes/posts.ts`）から `z.toJSONSchema` で**生成**し、
`apps/web/worker/senders-contract.test.ts` の file snapshot が `pnpm test`（CI の `ci` script）で一致を検査する。
送り側は raw GitHub の URL で読み、schema.json を自分のリポに vendoring して builder の出力を `z.fromJSONSchema` で検証する
契約テストを持つ。**上限や鍵を ADR や skill に転記しない**（転記が今回の事故）。受け側は実行時に送り側を知らないまま
（[ADR-0002](0002-api-posting-via-receiver-side-pat.md) は変わらない）。

## Considered options

- **本番に契約を返す route（`/api/schema` 等）**: 常に deploy 済みの版を返せるが、未認証の公開面が 1 つ増える。苔むすは
  私的で公開 route を最小にする（[security.md](../security.md)）。raw GitHub は既に public で到達済みなので要らない。
- **npm パッケージ `@kokemusu/contract`**: 型で縛れるが、送り側が版を上げない限り同じスナップショットで、drift は防げない。
  publish の儀式・LICENSE（このリポには無い）・`private: true` の解除が要る。過剰。
- **okayus-skills に苔むすの契約を書く**: 全コンテナに `~/.claude/skills:ro` で見えるが、それは転記の再演。skill には
  「受け側の公開文書を raw で読み、schema を vendoring して契約テストを書く」という**手順だけ**を置く。
- **ホストの `docker-compose.override.yml` で `../kokemusu/docs` を送り側コンテナに mount**: 到達性は既にあり、ホスト固有の
  配線を増やすだけ。不採用。
- **Hono RPC の `AppType` を共有**: パッケージ配布が前提で npm 案と同じ。不採用。
- **公開する（採用）**: 文書 ＋ 生成物 ＋ 一致テスト。

## Consequences

- `createPostSchema` を変えると `pnpm test` が落ちる。直すには `vitest -u` で schema.json を再生成し、`docs/senders.md` の
  変更履歴に 1 行足す。生成テストは各キーの説明を `Record<キー, string>` で持つので、キーを足して説明を書き忘れると `tsc` が落ちる。
- wire を変える PR は、公開されている送り側の実装（`docs/senders.md` の一覧）を raw GitHub で確認する。受け側が送り側を
  知るのは**この保守手順の中だけ**で、コードには入れない。
- 送り側の契約テストは、送り側が schema.json を更新したときに drift を検出する。更新の合図は受け側の変更履歴か、送り側の
  ログの 400。`Idempotency-Key` は引き続き「必要になってから」。
- `docs/senders/` は Workers Builds の監視パス除外（`docs/*`）に入るので、生成物だけの変更は deploy を起こさない。
  wire の変更はコードを伴うのでその PR で deploy される。
