# 苔むす (kokemusu) — プロジェクト指示

> 個人用の日記 Web アプリ。ツイート感覚で 1 日に何度も投稿し、タグごとに積み上げて「これまで自分が何をしてきたか」をグラフィカルに振り返る。ソーシャル機能なし・完全プライベート・各自セルフホスト。

このファイルは**規約と目次だけ**（コンテナ内も含めどのセッションでも最初に読まれる）。進捗と次の一手は `docs/status.md`（SessionStart hook が自動注入）、履歴は `docs/log.md` と git、決定は `docs/adr/` と `CONTEXT.md`。**ここに進捗・履歴・完了報告を書かない。**

## 進捗の持ち方（status hub）

- `docs/status.md` = いまのハブ。**40 行 / 3 KB 上限**、見出しは「フェーズ / 次の 3 手 / 詰まり・人手待ち / 進行中 PR」の 4 つ固定。終わった項目は消して `docs/log.md` の先頭へ 1 行（取り消し線は禁止）。8 行を超える節は `docs/plans/<topic>.md` に切り出し、完了したら削除。
- セッションの区切りでユーザが `/handoff` を打つ（書き換え → log → `.claude/hooks/check-status.sh` → commit）。CI も同じ検査を走らせる。
- `/compact` するときは、変更したファイル一覧と「次の 3 手」の 1 手目を必ず要約に残す。

## まず読むドキュメント

- `README.md` 概要と目次 ／ `docs/concept.md` 名前の由来・メタファー ／ `docs/features.md` `docs/visualization.md` 機能と可視化（可視化が核心）
- `docs/security.md` セキュリティ設計（最重要） ／ `docs/tech-stack.md` `docs/data-model.md` ／ `docs/dev-environment.md` サンドボックス・token 注入・Workers Builds・骨格 ／ `docs/roadmap.md` フェーズと「決めること」 ／ `CONTEXT.md` 用語 ／ `docs/adr/` 決定

## 確定済みの決定（要点。根拠と経緯は docs / ADR）

- **デプロイ = Cloudflare Workers + D1、経路は Workers Builds（キーレス）**: GitHub に Cloudflare トークンを置かない。`main` は ruleset（PR 必須・required check `ci`・force push 禁止・bypass なし）。リポは **public**（私的データ・`.dev.vars`・`.docker/sandbox.env`・D1 ダンプは決してリポに入れない）。
- **本番 URL = `https://kokemusu.shiraoka.workers.dev`**（subdomain なしの URL は存在しない）。**WebAuthn の RP_ID = `kokemusu.shiraoka.workers.dev`** を初回パスキー登録前に固定する（変更すると登録済みパスキーが全部無効。custom domain へ移るなら登録より前）。`wrangler.jsonc` の `name` / `vars.RP_ID` / `vars.ORIGIN` は変更しない。
- **アプリ認証 = パスキー（single-user）、API 自動投稿 = PAT（Bearer）**。受け側 = kokemusu が発行し、送り側を知らない（ADR-0002）。
- **本文（と見出し）は Phase 1 からアプリ層で暗号化**（鍵 `BODY_KEY` = Worker Secret、1Password にも控える）。日時・タグ等のメタデータは平文で可視化集計と両立（ADR-0001）。端末側 E2E は不採用。
- **React 19 + Vite + TS ／ Hono ／ D1 + Drizzle**、wrangler 4 + `@cloudflare/vite-plugin` 1.x、**node は host / sandbox / CI / Workers Builds とも 24**。pnpm workspace: `apps/web` に SPA（`src/`）+ Worker（`worker/`）+ `drizzle/` + `wrangler.jsonc`。`packages/core` はロジックが生えたら。型は `wrangler types`（`pnpm check` = `wrangler types && tsc --noEmit`、`worker-configuration.d.ts` は gitignore）。単体テストは Cloudflare plugin を通さず Node で `app.request()`。ローカルは `apps/web/.dev.vars`（`.dev.vars.example` をコピー、`RP_ID=localhost`）。
- 開発はサンドボックス（Docker + egress firewall）内。ホスト側 dev ポート **5273**。

## 働き方の規約

- **TypeScript は関数のみで書く。`class` を使わない。** ドメインロジックは副作用のない純粋関数に寄せ、I/O は境界に押し出す。
- **デプロイ基盤を先に通してからロジックを載せる**。歩く骨格は本番稼働済み（ロジック = ゼロ）。認証 / CSP / スキーマは骨格に載せない。実スキーマ投入前に skill `cloudflare-d1-drizzle-migration` 必読。
- **公式ドキュメントの調べ方（3 層。事前学習の記憶で API を断定しない）**: 1. `context7` MCP（`resolve-library-id` → `query-docs`。Cloudflare は `cloudflare-docs` MCP を最優先）→ 2. `llms.txt` の直読み（`hono.dev` `orm.drizzle.team` `react.dev` `vite.dev` `vitest.dev` `zod.dev` `developers.cloudflare.com` の `/llms.txt`。目次 → 必要ページ。`llms-full.txt` は最後の手段）→ 3. WebSearch → WebFetch（allowlist 外の URL は取得できない → 1 に戻る）。
- **HTML / CSS / UI を書く前に `modern-web-guidance` を読む**: `<dialog>`・popover・`<details>`・`<form>` のネイティブ検証・anchor positioning・container queries・subgrid・view transitions・`:has()` を React / JS で再発明しない。可視化は自作 SVG が基本（`docs/visualization.md`）。
- **git**: コンテナ内で `claude/<topic>` に commit → `git push -u origin claude/<topic>` → `gh pr create --fill` → PR の URL を報告（PR 本文の修正は `gh pr comment`。`gh pr edit` は古い `gh` が Projects classic の GraphQL エラーで落ちる）。**merge は人間がホストで行う**（`gh pr merge` / `gh api` は deny）。状態は `gh pr view` / `gh pr checks`。**token は印字しない（`echo $GH_TOKEN` 禁止）・`gh auth login` しない・URL に埋めない。** `.github/workflows/**` は人間がホストから push（コンテナの token に `workflows` 権限が無い）。merge 後は `git fetch --prune`。
- セキュリティ最優先（`docs/security.md`）。
- Claude Code 自体の機能・設定で不明な点は https://code.claude.com/docs/llms.txt を WebFetch して確認する。

## ツールセット（共有設定。詳細は `docs/dev-environment.md`）

- `.claude/settings.json`: 日常コマンドの allow。deny = force push・`main` への push（`HEAD:main` 等の refspec 形も）・リモートブランチ削除（`--delete` 形と `git push origin :branch` の refspec 形の両方）・`gh pr merge`・`gh auth`・`gh api`（コンテナ既定の bypassPermissions では deny だけが効く）。`hooks.SessionStart` → `.claude/hooks/session-start.sh`。
- `.mcp.json`: `cloudflare-docs`（認証不要）と `context7`（キー無し）。`.claude/skills/`: `grill-with-docs`（決定を `CONTEXT.md` / ADR に落とす）、`handoff`（進捗の書き戻し）、`modern-web-guidance`（出自と版は `skills-lock.json`、更新は `npx skills update`）。
- GitHub token は **`./shell.sh` が開くシェルにだけ** 注入（`op read` で解決 → `docker exec -it -e GH_TOKEN kokemusu-dev`。対話プロセスを `op run` で包むと TTY が壊れる）。コンテナ設定には載せない（`./up.sh` = plain `docker compose up -d`、資格情報なし・冪等）。op 無しのシェルは token 無し = fail closed。firewall allowlist と反映手順（`docker compose down && docker compose build && ./up.sh`）は `docs/dev-environment.md` §1。

## 参照スキル（okayus-skills。コンテナには `~/.claude/skills:ro`）

`agent-status-hub`（この status hub の出典。hook / `/handoff` / 検査の雛形）／ `claude-code-docker-sandbox` ／ `sandboxed-agent-github-token-via-1password`（push / PR 経路）／ `cloudflare-mcp-claude-tooling` ／ `cloudflare-workers-deploy-skeleton` ／ `cloudflare-workers-builds-keyless-deploy`（0.3.0、dash 手順の walkthrough 付き）／ `cloudflare-d1-drizzle-migration` ／ `cloudflare-workers-passkey-auth`（single-user 変種。UNVERIFIED を実装時に書き戻す）／ `cloudflare-workers-pat-bearer-auth` ／ `cloudflare-workers-e2e-playwright` `playwright-e2e-in-docker-sandbox` ／ `cloudflare-workers-bot-scan-defense` ／ `cloudflare-d1-weekly-backup-via-pr`（public リポなので git-commit 変種は不可。keyless 変種を skill 側に足してから）
