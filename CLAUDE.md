# 苔むす (kokemusu) — プロジェクト指示

> 個人用の日記 Web アプリ。ツイート感覚で1日に何度も投稿し、タグごとに積み上げて
> 「これまで自分が何をしてきたか」をグラフィカルに振り返る。ソーシャル機能なし・完全プライベート・各自セルフホスト。

このファイルは、**コンテナ内も含めどの Claude セッションでも最初に読む前提**の要約。
詳細は `docs/` にある（このファイルは目次＋働き方の規約）。

## まず読むドキュメント

- `README.md` — 概要と目次
- `docs/concept.md` — 名前の由来（苔むす＝苔生す）・メタファー・コア体験
- `docs/features.md` / `docs/visualization.md` — 機能と可視化（可視化が核心）
- `docs/security.md` — セキュリティ設計（最重要：プライベート内容を扱う）
- `docs/tech-stack.md` / `docs/data-model.md` — 技術選定とデータモデル
- `docs/dev-environment.md` — 開発環境・Cloudflare 認証・デプロイ骨格（※ 2026-06 の調査メモ。デプロイ経路と git 運用は下記「確定済みの決定」が正で、docs 側は追従待ち）
- `docs/roadmap.md` — フェーズと「決めること」

## 確定済みの決定（2026-08-22 更新）

- **デプロイ: Cloudflare Workers + D1**（各自が自分の CF アカウントにデプロイ＝セルフホスト）。**デプロイ経路は Workers Builds（キーレス）**＝GitHub に Cloudflare トークンを置かない（skill `cloudflare-workers-builds-keyless-deploy`）。main は ruleset（PR 必須・required check `ci`・force push 禁止・bypass なし）で保護。リポは **public**（ruleset の強制が無料・セルフホスト配布の前提。私的データ・`.dev.vars`・`.docker/sandbox.env`・D1 ダンプは決してリポに入れない）。
- **本番 URL = `https://kokemusu.shiraoka.workers.dev`**（account subdomain は `shiraoka`。`kokemusu.workers.dev` のような subdomain なし URL は存在しない）。**WebAuthn の RP_ID = `kokemusu.shiraoka.workers.dev`** を初回パスキー登録前に固定する（変更すると登録済みパスキーが全部無効。custom domain へ移るなら登録より前に）。
- **アプリ認証 = パスキー / WebAuthn**（単一ユーザ。skill `cloudflare-workers-passkey-auth` の single-user 変種＝spaces / invite なし）。**API 自動投稿 = PAT（Bearer）**（skill `cloudflare-workers-pat-bearer-auth`。受け側＝kokemusu が発行し、送り側が保持。kokemusu は送り側を知らない）。
- **フロント = React 19 + Vite + TS / API = Hono / DB = D1 + Drizzle**。toolchain は wrangler 4 + `@cloudflare/vite-plugin` 1.x（deploy-skeleton の現行基準）。**node は host / sandbox / CI とも 24**。
- 開発はサンドボックス（Docker + egress firewall）内。ホスト側 dev ポートは **5273**（5173 = 汎用 Vite、5373 = mazuoboeru）。
- **git / GitHub（2026-08-22）**: コンテナには **kokemusu 1 リポ限定の GitHub fine-grained PAT**（Contents + Pull requests、Workflows なし、90 日）が `./up.sh`（= `op run --env-file=.docker/sandbox.env -- docker compose up -d`）で **env にだけ**注入される（skill `sandboxed-agent-github-token-via-1password`、mazuoboeru で実証済み）。credential helper は env を読む inline 関数、`gh` は `GH_TOKEN` を直接読む。**plain `docker compose up -d` で起動した container に token は無い**（fail closed・起動ログに NOTE）。
- **Claude Code ツールセット**:
  - `.claude/settings.json`（共有）: pnpm / wrangler / git / gh の日常コマンドと docs ドメインの `WebFetch` を allow。deny は **force push・`main` への push（`HEAD:main` 等の refspec 形も）・リモートブランチ削除・`gh pr merge`・`gh auth`・`gh api`**（コンテナ既定の bypassPermissions では deny だけが効く。allow はホスト側セッション用）。
  - `.mcp.json`（共有）: **`cloudflare-docs`**（Cloudflare 公式・認証不要）と **`context7`**（`https://mcp.context7.com/mcp`・キー無し。MDN を含むライブラリ docs の横断検索）。bindings / builds / observability MCP は wrangler と被るので入れない。
  - サンドボックス firewall（`.docker/init-firewall.sh`）: 致命リスト = npm / anthropic / cloudflare API / `developers.cloudflare.com` / `docs.mcp.cloudflare.com`。**OPTIONAL**（解決失敗でも起動継続）= Statsig・本番ホスト・docs ホスト（`mcp.context7.com` `developer.mozilla.org` `react.dev` `hono.dev` `orm.drizzle.team` `vite.dev` `vitest.dev` `zod.dev` `developer.chrome.com` `web.dev`）。IP ベースなので同じ anycast（Cloudflare / Vercel / Fastly / Google）の兄弟サイトも通る＝読み取り用途として許容。`mcp.context7.com` は AWS ELB で IP が変わり得る → Context7 が応答しなくなったらコンテナ再起動で再解決。**反映は `docker compose down && docker compose build && ./up.sh`（プロジェクトディレクトリで `-f` を付けず＝override 自動ロード）**。
  - **`modern-web-guidance`**（Google Chrome・Apache-2.0）を project scope `.claude/skills/modern-web-guidance/` に同梱（`npx skills add GoogleChrome/modern-web-guidance@modern-web-guidance`。出自と版は `skills-lock.json`、更新は `npx skills update`）。オフラインで動き、実行時に Google へ取りに行かない。`grill-with-docs` も同梱。okayus-skills はコンテナに `~/.claude/skills:ro` で見える（gitignore の `docker-compose.override.yml`）。

## 働き方の規約（重要）

- **TypeScript は関数のみで書く。`class` を使わない。** ドメインロジックは副作用のない純粋関数に寄せ、I/O は境界に押し出す。
- **デプロイ基盤を先に通してからロジックを載せる**（「歩く骨格」: `main` push → 本番 `/health` 200 ＆ SPA 表示、ロジック=ゼロ）。認証 / CSP / スキーマは骨格には載せない。
- **公式ドキュメントの調べ方（3 層。事前学習の記憶で API を断定しない）**:
  1. **`context7` MCP**（`resolve-library-id` → `query-docs`）— MDN / Hono / Drizzle / React / Vite / Cloudflare Workers を横断。Cloudflare は **`cloudflare-docs` MCP** を最優先。
  2. **`llms.txt` の直読み**（WebFetch）— `hono.dev/llms.txt`・`orm.drizzle.team/llms.txt`・`react.dev/llms.txt`・`vite.dev/llms.txt`・`vitest.dev/llms.txt`・`zod.dev/llms.txt`・`developers.cloudflare.com/llms.txt`。目次 → 必要ページの順で読み、`llms-full.txt` は最後の手段（巨大）。MDN / TypeScript / Tailwind / web.dev に `llms.txt` は無い → 1 か、ページを直接 WebFetch。
  3. **WebSearch → WebFetch** — WebSearch は Anthropic 側で実行されるので egress 不要（返るのはタイトルと URL）。見つけた URL が allowlist 外なら取得できないので 1 に戻る。
- **HTML / CSS / UI を書く前に `modern-web-guidance` を読む**: `<dialog>`・popover・`<details>`・`<form>` のネイティブ検証・anchor positioning・container queries・subgrid・view transitions・`:has()` など**プラットフォームにある機能を React / JS で再発明しない**。Baseline を確認し、ガイドの anti-pattern 節にある古い書き方を避ける。可視化（ヒートマップ・積み上げ・苔の庭）は自作 SVG が基本（`docs/visualization.md`）。
- **git: コンテナ内で `claude/<topic>` に commit → `git push -u origin claude/<topic>` → `gh pr create --fill` → PR の URL を報告する。merge は人間がホストで行う**（`gh pr merge` / `gh api` は deny）。PR・CI の状態は `gh pr view` / `gh pr checks`（fine-grained PAT は Checks REST API を呼べない）。**token は印字しない（`echo $GH_TOKEN` 禁止）・`gh auth login` しない・URL に埋めない。** `.github/workflows/**` は人間がホストから push（token に `workflows` 権限が無く remote が拒否する）。merge 後は `git fetch --prune`。
- セキュリティ最優先。**本文（と見出し）は Phase 1 から Worker がアプリ層で暗号化（鍵 `BODY_KEY` は Worker Secret・1Password にも控える）、日時・タグ等メタデータは平文**で可視化集計と両立（`docs/adr/0001-body-encrypted-at-app-layer.md`、`docs/security.md`）。端末側 E2E (C) は不採用。用語は `CONTEXT.md`。
- Claude Code 自体の機能・設定で不明な点は https://code.claude.com/docs/llms.txt を WebFetch して確認する。

## 参照スキル（okayus-skills）

Cloudflare / sandbox の手順は `okayus-skills` のスキルに集約（リポ外。コンテナには override mount で `~/.claude/skills:ro` として見える）。

- `claude-code-docker-sandbox` — 開発サンドボックス（2026-08-22 に node:24 版へ再同期）
- `sandboxed-agent-github-token-via-1password` — **現行の push / PR 経路**（1 リポ限定 PAT を 1Password で注入）
- `cloudflare-mcp-claude-tooling` — docs MCP・permissions・`grill-with-docs`
- `cloudflare-workers-deploy-skeleton` — SPA+API+Cron の歩く骨格（**次にやる**。wrangler 4 / vite-plugin 1.x）
- `cloudflare-workers-builds-keyless-deploy` — Workers Builds キーレスデプロイ＋main ruleset
- `cloudflare-d1-drizzle-migration` — D1 で drizzle-kit を安全に（実スキーマ投入時に必読）
- `cloudflare-workers-passkey-auth` — パスキー認証（single-user 変種。UNVERIFIED を実装時に書き戻す）
- `cloudflare-workers-pat-bearer-auth` — API 自動投稿用の PAT（受け側実装）
- `cloudflare-workers-e2e-playwright` / `playwright-e2e-in-docker-sandbox` — WebAuthn 仮想 authenticator の e2e をコンテナ内で
- `cloudflare-workers-bot-scan-defense` — 認証 / PAT route のレート制限
- `cloudflare-d1-weekly-backup-via-pr` — **public リポなので「git に commit」変種は不可**。keyless 変種（ホスト timer か Worker→R2）を skill 側で追加してから適用

## 次のアクション

1. ~~リポ作成（public）・sandbox 再同期・token 配線・MCP（cloudflare-docs + context7）・docs egress・`modern-web-guidance` 同梱・CI プレースホルダ・ruleset~~ → **完了（2026-08-22）**
2. **人手**: fine-grained PAT（Repository access = `okayus/kokemusu` のみ、Contents + Pull requests、Workflows なし、90 日）→ `op item create --category "API Credential" --vault "<vault>" --title "github-pat-kokemusu-sandbox" 'credential=<token>' 'expires=<YYYY-MM-DD>'` → `./up.sh`
3. E2E → **2026-08-22 に通過**: token で push → `gh pr create`（#1）→ `gh pr checks` 緑／PR の無い commit の `HEAD:main` push は `GH013 Changes must be made through a pull request`／`.github/workflows/ci.yml` 変更の push は `without \`workflow\` scope` で remote 拒否／docs egress 10 ドメインすべて到達（`example.com` と `context7.com` は遮断＝allowlist どおり）／`npx -y modern-web-guidance@latest search "modal dialog"` がコンテナ内で動作。コンテナ内 `claude` を再ログインし `cloudflare-docs` / `context7` の MCP を承認（✔ Connected）。bypass 下の deny probe も通過: `gh pr merge --help` / `gh auth status` / `gh api …` / `git push origin HEAD:main`（refspec 形）はすべて denied、`gh pr view` は実行。Context7 でコンテナ内から MDN（`/mdn/content`）を解決し `<dialog closedby>` を正答。`down`→plain `up` の fail closed は mazuoboeru（同一 compose 配線）で実証済み
4. docs の drift 修正（`docs/dev-environment.md` の GH Actions token 経路 / RP_ID / node20 記述、`docs/data-model.md` に `post.title` と `api_token`、`docs/features.md` / `roadmap.md` に API 自動投稿とタグ関係グラフ）→ `/grill-with-docs`（title の位置づけ、mazuoboeru 連携を自分専用 (i) にするか per-user (ii) にするか、暗号化レベル）
5. Phase 0: ホストで `wrangler login` → `wrangler d1 create kokemusu-db` → Workers Builds 接続（root は骨格の配置に合わせる・D1 Edit 入りカスタムビルドトークン・非本番ブランチビルド OFF）→ deploy-skeleton → `/health` 200 → `ci.yml` を typecheck / build / test に置換
