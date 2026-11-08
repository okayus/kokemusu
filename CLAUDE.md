# 苔むす (kokemusu)

個人用の日記 Web アプリ。ツイート感覚で 1 日に何度も投稿し、タグごとに積み上がった記録を可視化で振り返る。ソーシャル機能なし・1 インスタンス 1 人・各自セルフホスト。用語は `CONTEXT.md`、決定は `docs/adr/`、設計は `docs/`（`security.md` が最重要。可視化が核心で `visualization.md`）。

## 進捗の持ち方

- 進捗と次の一手は `docs/status.md`（SessionStart hook が毎回注入する）、履歴は `docs/log.md` と git。このファイルには規約だけを書く。
- `status.md` は 40 行 / 3 KB 以内、見出しは「フェーズ / 次の 3 手 / 詰まり・人手待ち / 進行中 PR」の 4 つで固定。終わった項目は消して `log.md` の先頭へ 1 行で移す（取り消し線は使わない）。8 行を超える節は `docs/plans/<topic>.md` に切り出す。書き戻しはユーザが打つ `/handoff`、上限の検査は `.claude/hooks/check-status.sh`（CI も走らせる）。

## 確定済みの決定（根拠は ADR）

- デプロイは Workers Builds（キーレス）で、GitHub に Cloudflare の資格情報を置かない。`main` は ruleset（PR 必須・required check `ci`・force push 禁止・bypass なし）。
- リポは public。私的データ、`.dev.vars`、`.docker/sandbox.env`、D1 のダンプはコミットしない。
- 本番 URL と WebAuthn の RP_ID は `kokemusu.shiraoka.workers.dev`。RP_ID を変えると登録済みのパスキーがすべて無効になるので、`wrangler.jsonc` の `name` / `vars.RP_ID` / `vars.ORIGIN` は変えない。
- 認証はパスキー（single-user）、API からの投稿は PAT（Bearer）。kokemusu は送り側を知らない（ADR-0002）。送り側の契約は `docs/senders.md` と生成物 `docs/senders/posts.schema.json`（`createPostSchema` から `pnpm test` が生成し、一致を検査する）。`createPostSchema`（wire）を変える PR は `vitest -u` で再生成し、`docs/senders.md` の変更履歴に 1 行足し、公開している送り側を確かめる。上限や鍵を他所に転記しない（ADR-0008）。
- 本文はアプリ層で暗号化する（鍵 `BODY_KEY` は Worker Secret）。日時・タグなどのメタデータは平文で、可視化と集計はメタデータだけで成り立たせる（ADR-0001）。

## コマンドと罠

- 開発はコンテナ内で行う。ルートから `pnpm dev`（コンテナ 5173 → ホスト 5273）、`pnpm check`、`pnpm test`、`pnpm build`。CI と同じ検査はルートで `pnpm run ci`（`pnpm ci` は pnpm 本体の別コマンドになる）。e2e はコンテナ内で `pnpm e2e`（`apps/web/e2e/README.md`）。
- ホストで開いたセッションでは、編集と git はホストで行い、pnpm はコンテナに投げる（起動は `./up.sh`、実行は `docker exec kokemusu-dev pnpm run ci`）。ホストで pnpm・npx を走らせない（`pnpm exec` も）。依存のコードが隔離の外で動き、コンテナの `node_modules` も壊れる。作業ツリーはコンテナと共有しているので、ブランチの切り替えはコンテナ側にも効く。
- `pnpm check` は `wrangler types` で `worker-configuration.d.ts`（gitignore）を作ってから tsc を走らせる。単体テストは Cloudflare plugin を通さず、Node で `app.request()` を呼ぶ。
- ローカルの変数は `apps/web/.dev.vars`（`.dev.vars.example` をコピーし、`RP_ID=localhost`）。
- migration（`apps/web/drizzle/`）を書く前に okayus-skills の skill `cloudflare-d1-drizzle-migration` を読む。

## 書き方

- TypeScript は関数だけで書き、`class` を使わない。ドメインロジックは純粋関数に寄せ、I/O は境界に置く。
- UI はブラウザのネイティブ機能を先に使う。`<dialog>`、popover、`<details>`、フォームのネイティブ検証、anchor positioning、container queries、`:has()` を React で作り直さない（詳しくは skill `modern-web-guidance`）。可視化は自作の SVG。
- API は記憶で断定せず、公式 docs で確かめる（`cloudflare-docs` MCP、`context7` MCP、各サイトの `/llms.txt`）。コンテナの firewall は allowlist 外の URL を通さない。Claude Code 自体の機能・設定は https://code.claude.com/docs/llms.txt で確かめる。

## git と merge

- `claude/<topic>` に commit し、push して `gh pr create` する。PR の題は Conventional Commits で書く（commit が 2 つ以上だと `--fill` の題がブランチ名になる — #39）。PR 本文の修正は `gh pr comment` で行う（`gh pr edit` は古い gh で落ちる）。
- CI が green になったのを確かめたら、`gh pr merge --auto --squash <PR番号>` で arm してよい（`--auto` は required check `ci` が通るまで merge を待たせる）。`--auto` なしの merge と `--admin` は使わない。持ち主に merge を頼まれたときは `/merge` の手順で進める。
- `apps/web/drizzle/`、`.github/**`、`.claude/**`、`docs/adr/**` を触る PR は自分から arm しない。持ち主が差分を見たうえで merge を頼んだときだけ（PR ができる前の「merge まで進めて」は含まない）、`/merge` で arm する。migration の PR はさらに、merge の直前にホストで `node ~/.config/d1-backup/d1-bookmark.mjs kokemusu <PR番号>` を実行してもらい、D1 Time Travel の bookmark が PR にコメントされるまで arm しない（コンテナには Cloudflare の資格情報がない）。既存行の書き換え・テーブルの再構築・DROP を含む migration なら、PR 本文に戻し方を書く。
- token は印字しない・URL に埋めない・`gh auth login` しない。コンテナでは token は `./shell.sh` が開いたシェルにだけある（無いシェルでは push できない）。ホストでは持ち主の gh の認証で push と PR 操作ができる。
- `.github/workflows/**` はコンテナの token では push できない（workflows 権限がない）。CI の中身は `package.json` の `ci` script、`.node-version`、`.claude/hooks/` で変えられる。
