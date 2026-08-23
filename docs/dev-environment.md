# 開発環境・デプロイ基盤

苔むす（Cloudflare Workers + D1）の開発環境と、デプロイ / 認証の配線。
2026-06-05 の okayus-skills 調査メモを **2026-08-22 に現行構成へ全面更新** した
（旧メモの「GitHub Actions に Cloudflare トークン」「git はホスト側のみ」「node:20」は廃止）。

> このファイルは「どう配線されているか」。日々の規約は `CLAUDE.md`、手順の詳細は各スキルが正。

## 使うスキルとフェーズ対応

| スキル | 用途 | 苔むすでの使いどころ |
| --- | --- | --- |
| `claude-code-docker-sandbox` | 開発を egress ファイアウォール付き Docker に隔離（node:24） | **Phase 0 — 構築済み**。npm / エージェント実行をホストから隔離 |
| `sandboxed-agent-github-token-via-1password` | 1 リポ限定の GitHub PAT を 1Password から起動時だけ注入 | **Phase 0 — 構築済み**。コンテナ内から push / `gh pr create` |
| `cloudflare-mcp-claude-tooling` | docs MCP・permissions・docs egress・`grill-with-docs` | **Phase 0 — 構築済み** |
| `cloudflare-workers-deploy-skeleton` | SPA + API + Cron を 1 Worker で、D1 マイグレ込みの「歩く骨格」 | **Phase 0** 骨格構築（wrangler 4 / `@cloudflare/vite-plugin` 1.x） |
| `cloudflare-workers-builds-keyless-deploy` | Workers Builds で **GitHub に Cloudflare トークンを置かずに** デプロイ ＋ main ruleset | **Phase 0** デプロイ経路（`deploy.yml` は作らない） |
| `cloudflare-d1-drizzle-migration` | D1 で drizzle-kit を安全に | **Phase 1** 実スキーマ投入時（必読） |
| `cloudflare-workers-passkey-auth` | パスキー認証（single-user 変種 = spaces / invite なし） | **Phase 1** 認証 |
| `cloudflare-workers-pat-bearer-auth` | API 自動投稿用 PAT（受け側） | **Phase 2** `POST /api/posts` を `post:write` で開ける |
| `cloudflare-workers-bot-scan-defense` | 公開直後の bot スキャン耐性・認証 / PAT route のレート制限 | **Phase 1〜** |
| `cloudflare-workers-e2e-playwright` / `playwright-e2e-in-docker-sandbox` | WebAuthn 仮想 authenticator の e2e をコンテナ内で | **Phase 1** |
| `cloudflare-d1-weekly-backup-via-pr` | D1 の定期バックアップ | **Phase 3**。public リポなので「git に commit」変種は不可 → keyless 変種（ホスト timer か Worker→R2）を skill 側で追加してから |
| `cloudflare-api-token-permissions` | CI 用 API トークンの権限診断 | **原則不要**（GitHub に CF トークンを置かない）。Workers Builds のビルドトークンの権限不足を引くときの参照 |
| `cloudflare-cron-to-discord` / `cloudflare-workflows-for-long-tasks` | Cron 通知 / 30 秒超の処理 | 当面不要 |

## 1. 開発サンドボックス（claude-code-docker-sandbox ＋ token 注入）

**狙い**: npm の postinstall 等のサプライチェーン攻撃と、エージェントの実行を、デフォルト拒否の egress ファイアウォール付きコンテナに封じ込める。ホストの `~/.ssh` や認証情報には触れない。

- 構成: `.docker/Dockerfile`（Anthropic 公式 devcontainer 由来、**node:24**、非 root `node`）、`.docker/init-firewall.sh`（egress 許可リスト）、`docker-compose.yml`（VS Code 非依存、`/workspace` に bind mount）、`up.sh`（後述）。
- **起動は `./up.sh`**（= `op run --env-file=.docker/sandbox.env -- docker compose up -d`）。plain `docker compose up -d` でも動くが **GitHub token が無い**（fail closed。起動ログに `NOTE: GH_TOKEN absent`）。
- 起動時に毎回: firewall → `claude` / `pnpm` を npm から更新 → git の credential helper（env の `$GH_TOKEN` を読む inline 関数・ディスクに書かない）と sandbox 用の git identity → コンテナ scope の Claude Code 既定を `bypassPermissions` に（リポ共有の `.claude/settings.json` は触らない）。
- **egress 許可リスト**（`.docker/init-firewall.sh`）:
  - 致命（解決失敗でコンテナ起動失敗）: `registry.npmjs.org`・`api.anthropic.com`・Cloudflare API・`developers.cloudflare.com`・`docs.mcp.cloudflare.com`・GitHub（IP レンジは動的取得）。
  - **OPTIONAL**（解決失敗でも起動継続）: Statsig・本番ホスト `kokemusu.shiraoka.workers.dev`・docs ホスト（`mcp.context7.com` `developer.mozilla.org` `react.dev` `hono.dev` `orm.drizzle.team` `vite.dev` `vitest.dev` `zod.dev` `developer.chrome.com` `web.dev`）。IP ベースなので同じ anycast 上の兄弟サイトも通る＝読み取り用途として許容。`mcp.context7.com` は AWS ELB で IP が変わり得る → Context7 が応答しなくなったらコンテナ再起動で再解決。
- **ポート**: ホスト `5273` → コンテナ `5173`（5173 は汎用 Vite、5373 は mazuoboeru）。ブラウザからは `http://localhost:5273`。
- **Claude Code のツール**（共有設定、`cloudflare-mcp-claude-tooling`）: `.mcp.json` に `cloudflare-docs`（公式・認証不要）と `context7`（MDN 含むライブラリ docs）。`.claude/settings.json` の deny = force push・`main` への push（refspec 形含む）・リモートブランチ削除・`gh pr merge`・`gh auth`・`gh api`（bypass 下でも deny だけは効く）。`modern-web-guidance`（Google Chrome・Apache-2.0）を `.claude/skills/` に同梱、`grill-with-docs` も同梱。okayus-skills は gitignore の `docker-compose.override.yml` で `~/.claude/skills:ro` に read-only mount（コピーしない＝drift なし）。
- **限界**: 許可ドメイン経由の流出やカーネル攻撃は防げない。許可リストは狭く保つ。

### 日常運用

- 起動 `./up.sh` ／ シェル `docker compose exec dev zsh` ／ 停止 `docker compose stop`（env は保持。`down` したら次は必ず `./up.sh`）。
- `.docker/*` や `docker-compose.yml` を変えたら **`docker compose down && docker compose build && ./up.sh`**（プロジェクトディレクトリで `-f` を付けず＝override 自動ロード）。`down -v` は Claude の認証も消える。
- コンテナ内 Claude の認証は named volume `claude-config` に永続。期限切れ時は `docker compose exec dev claude` で再ログイン。

## 2. GitHub 運用（コンテナ内 git・2026-08-22 から）

旧「commit / push はホスト側」は廃止。コンテナ内の Claude が自分で push と PR まで行う（`sandboxed-agent-github-token-via-1password`）。

- **token**: 自分の GitHub **fine-grained PAT**、Repository access = `okayus/kokemusu` のみ、**Contents + Pull requests**（Metadata 自動）、**Workflows なし**、**90 日**。1Password にだけ保存し、`.docker/sandbox.env`（gitignore・`op://` 参照のみ）経由で `./up.sh` が **コンテナの env にだけ** 注入する。ディスクには書かない（`~/.git-credentials` も `~/.config/gh/hosts.yml` も無い）。
- **流れ**: `claude/<topic>` ブランチで commit → `git push -u origin claude/<topic>` → `gh pr create --fill` → PR URL を報告。**merge は人間がホストで**（`gh pr merge` は deny）。状態確認は `gh pr view` / `gh pr checks`（fine-grained PAT は Checks REST API を呼べないので `gh api …/check-runs` は使えない＝deny でもある）。merge 後は `git fetch --prune`。
- **`.github/workflows/**` は人間がホストから push**（token に `workflows` 権限が無く、remote が `without \`workflow\` scope` で拒否する。これは意図的＝エージェントが自分の CI ゲートを書き換えられない）。
- **禁止**: token の印字（`echo $GH_TOKEN`）・`gh auth login`（ディスクに書く）・URL への埋め込み。
- **境界は ruleset と token scope**。Claude Code の allow / deny は「行儀の良いエージェント」向けの利便で、セキュリティ境界ではない。侵害されたサンドボックスが出来ること = この 1 リポの非保護ブランチへの push と PR 操作（CI 緑の PR の merge 含む）、token 失効まで。
- **ローテーション**: 90 日ごと（1Password の `expires` が一次情報）。push が `401` になったらまず期限を疑う。

## 3. Cloudflare の認証方式（2 系統）

「Cloudflare の認証」には **(a) デプロイ用** と **(b) アプリのユーザ認証** の 2 つがある。

### (a) デプロイ = Workers Builds（キーレス）

**GitHub にも、リポにも、サンドボックスにも Cloudflare のトークンは置かない。** Cloudflare 側の git 連携 CI（Workers Builds）が GitHub App 経由でリポを pull してビルド・デプロイする（`cloudflare-workers-builds-keyless-deploy`）。GitHub Actions は test / typecheck のみで **Actions Secrets は空**。2026-08 時点で Cloudflare API に OIDC は無く、これが唯一の「GitHub 側ゼロ credential」経路。

```
PR ブランチ push → GitHub Actions `ci`（typecheck / build / test。秘密なし）
main へ merge（ruleset: PR 必須・required check `ci`・force push 禁止・bypass なし）
   └→ Workers Builds: install → build → D1 migrate → wrangler deploy（Cloudflare 側）
```

- **不変条件: `main` は常に CI 緑**。Workers Builds は GitHub CI の結果を **待たない** ので、ゲートは merge 時の ruleset に置く。
- **一度だけの人手（secret-zero）**:
  1. **My Profile でカスタムトークンを先に作らない**（2026-08-23 に実測: 作っても設定画面の API トークン picker に**出てこない**。picker に並ぶのは dash が生成した他プロジェクトの `<project> Workers Builds` トークンと「新しいトークンを作成する」だけ）。
  2. リポ接続: dash → Workers & Pages → Create → Continue with GitHub。GitHub App が既にインストール済みなら認可画面は出ず、リポ一覧が直接出る（scope は GitHub 側 Settings → Applications で管理）。
  3. 設定（下表）。⚠️ **Root directory は「詳細設定 / Advanced settings」アコーディオンの中で「パス」表記**。同じ中に API トークン picker がある: **「新しいトークンを作成する」** を選び `kokemusu Workers Builds` と命名（既定は直前に接続した別プロジェクトのトークンになっている）。「非本番ブランチのビルド」のチェックはこのダイアログで外せる。
  4. デプロイ → 初回は**手動ビルド**として走る（GitHub の check-run は付かない）。作成後 Settings → ビルド で watch paths の除外を追加。画面別の手順と browser agent 向けの注意は skill 0.3.0 の `references/dashboard-walkthrough.md`。

| 設定 | 値 | 間違えたとき |
| --- | --- | --- |
| Worker 名 | `kokemusu`（`wrangler.jsonc` の `name` と一致） | 不一致だと 2 つ目の Worker ができる |
| Root directory（Advanced settings） | `apps/web`（`wrangler.jsonc` のあるパッケージ） | 全コマンドがリポ root で走って失敗 |
| Build command | `pnpm install --frozen-lockfile && pnpm run build` | lockfile はリポ root にある。pnpm は workspace root を上向きに見つける |
| Deploy command | `pnpm exec wrangler d1 migrations apply kokemusu-db --remote && pnpm exec wrangler deploy` | migrate が deploy に先行する。`pnpm exec` でリポ pin の wrangler を使う |
| API token（Advanced settings） | picker の「新しいトークンを作成する」で生成した `kokemusu Workers Builds` | docs は生成トークンに D1 が無いと書くが、2026-08-23 の dash では **D1 Storage (edit) 入り**で migrate が通った。migrate が `Authentication error [code: 10000]` で落ちたら My Profile → API Tokens でそのトークンに D1 Edit を足す（原因を名指ししない） |
| Branch control | production = `main`、**非本番ブランチビルド OFF** | ⚠️ preview version も **本番 D1** を共有する（`preview_database_id` は `wrangler dev` 専用）。PR preview が本番データを触り、migrate まで走る |
| Build watch paths（Advanced） | include `*`、exclude `docs/*` と `*.md`（docs-only commit でデプロイしない） | required check `ci` は Workers Builds と独立なので merge ゲートは保たれる。CI 側を `paths-ignore` で間引くのは **不可**（required check が pending で PR が詰まる） |

- **確認**: merge 後に commit の check-run に `Workers Builds: kokemusu` が付く（`gh pr checks` / dash の Builds タブ。`gh api` は deny）。ホストで `wrangler deployments list`、`wrangler d1 migrations list kokemusu-db --remote`、`curl https://kokemusu.shiraoka.workers.dev/health`。
- **ハマりどころ**: Root directory 未設定（Advanced の中の「パス」）／本番ブランチに `apps/web` が未 merge（設定ミスに見える）／トークンに D1 が無く migrate だけ落ちる／**初回の手動ビルドには check-run が付かない**（未トリガーと誤診しない。push 起動は次の merge で実証）／**push しても何も起きない** = 非本番ブランチ（意図どおり）・watch paths が全部除外・稀に build が作られない（check-run に `Workers Builds:` が無い＝未トリガー。`main` に新しい commit を push して再トリガー。dash の Retry は最新 build の再実行で、取りこぼした commit は拾わない）。
- Free プラン: 3,000 build 分 / 月、同時 1、20 分タイムアウト。個人規模には十分。
- `workers.dev` の URL は常に `<worker>.<account-subdomain>.workers.dev`。**苔むすは `https://kokemusu.shiraoka.workers.dev`**（`kokemusu.workers.dev` は存在しない）。account subdomain を変えると全 Worker の URL が変わる → パスキー登録前に確定（下記 RP_ID）。

### (b) アプリのユーザ認証 = パスキー（single-user）＋ API 用 PAT

- **パスキー / WebAuthn**（`cloudflare-workers-passkey-auth` の single-user 変種: spaces / invite なし）。初回登録は一度きりの `INITIAL_REGISTRATION_TOKEN`（Worker Secret）で開け、登録後に削除して閉じる。セッションは `sessions` 行に裏打ちされた HS256 JWT（失効可能・30 日 sliding）、Cookie は host-only `__Host-`。詳細は [security.md](security.md) / [data-model.md](data-model.md)。
- ⚠️ **RP_ID ロック: `RP_ID = kokemusu.shiraoka.workers.dev` / `ORIGIN = https://kokemusu.shiraoka.workers.dev`** を `wrangler.jsonc` の `vars` に **初回パスキー登録より前に固定**。後で変えると登録済みパスキーが **全部無効**（custom domain に移るなら登録より前に）。`RP_ID` / `ORIGIN` を変える diff は PR で自動 reject 扱い。
- ローカルは `.dev.vars`（gitignore）で `RP_ID=localhost` / `ORIGIN=http://localhost:5173` に上書き（`.dev.vars` は `vars` より優先、本番には届かない）。
- **API 自動投稿 = PAT（Bearer）**（`cloudflare-workers-pat-bearer-auth`）: 苔むすが発行し（設定画面・セッション必須・一度だけ表示）、送り側（まず mazuoboeru）が保持して `Authorization: Bearer kokemusu_pat_…` で `POST /api/posts`。苔むすは送り側を知らない。DB には `sha256(token + PAT_PEPPER)` だけ（pepper は Worker Secret）。→ [features.md](features.md) §7。
- e2e: `cloudflare-workers-e2e-playwright` の **WebAuthn 仮想 authenticator** で register / login の配線まで実テスト（`DEV_BYPASS_USER_ID` で逃げない）。コンテナ内で走らせる手順は `playwright-e2e-in-docker-sandbox`（Chromium をイメージに焼く・`127.0.0.1` bind・rate limit binding を外す）。

## 4. デプロイ骨格（cloudflare-workers-deploy-skeleton）

ゴール: **`main` merge → Workers Builds → `https://kokemusu.shiraoka.workers.dev/health` が 200 ＆ `/` が SPA HTML**、ビジネスロジック = ゼロ。

- toolchain: **wrangler 4 ＋ `@cloudflare/vite-plugin` 1.x**（skill の現行基準。0.1.x / wrangler 3 はローカル Cron endpoint が無い）。node は host / sandbox / CI / Workers Builds とも **24**。
- 配置: pnpm workspace。`apps/web/` に SPA（`src/`）と Worker（`worker/{index,cron,types}.ts`）と `wrangler.jsonc`、`drizzle/0000_init.sql`（`SELECT 1;` の空マイグレ＝パイプライン検証用）、`.dev.vars.example`。`packages/core`（純粋関数のドメインロジック）はロジックが生えた時点で切る（空パッケージは作らない）。
- **3 層 SPA ルーティング**（どれか欠けると `/` が 404）:
  - L1 `wrangler.jsonc`: `assets.not_found_handling: "single-page-application"`
  - L2 `wrangler.jsonc`: `assets.run_worker_first: true`（後で secureHeaders が SPA HTML を包める）
  - L3 `worker/index.ts`: `app.notFound` で `c.env.ASSETS.fetch` に委譲
- **`deploy.yml` は作らない**（skill のテンプレのうち GitHub Actions デプロイ部分は Workers Builds に置き換え）。`.github/workflows/ci.yml` = `pnpm install --frozen-lockfile` → typecheck → build → test（job id `ci` は ruleset の required check 名。**変えない**）。
- 型は `wrangler types`（`worker-configuration.d.ts` を生成。binding を変えたら再生成）。`@cloudflare/workers-types` は使わない。
- **ハマりどころ**:
  - `pnpm deploy` が pnpm 組込みと衝突 → root の `package.json` は `"deploy": "pnpm --filter @kokemusu/web run deploy"`（明示 `run`）。
  - `database_id` の placeholder → `wrangler d1 create kokemusu-db` の UUID に置換してからでないとデプロイできない（UUID は秘密ではない。public リポに commit してよい）。
  - ローカル Cron は `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=<expr>"`（vite-plugin 1.x / wrangler 4）。Dashboard から手動発火は **できない**。
- **スコープ外（骨格では作らない）**: 認証・secureHeaders / CSP・ドメインスキーマ・drizzle-orm / drizzle-kit（実スキーマが要るまで入れない。入れる前に `cloudflare-d1-drizzle-migration` 必読）。**デプロイが通ってからロジックを載せる。**

## セットアップ順（Phase 0）

> 2026-08-23 にすべて完了（[log.md](log.md)）。以下はセルフホスト時の再現用。

1. ~~コンテナ（`docker compose build && ./up.sh`）・token 注入・MCP・docs egress・ruleset~~ → **完了（2026-08-22）**。
2. **人手（ホスト・対話）**: `wrangler login` → `wrangler d1 create kokemusu-db` → `database_id` の UUID を控える。
3. **エージェント（コンテナ内）**: 骨格を生成（`apps/web`、`name: kokemusu`、`RP_ID` / `ORIGIN` は本番ホスト名で day 1 固定）→ `pnpm install` → `pnpm check` → ローカルマイグレ → `pnpm dev` で `/health` と `/` を確認 → `claude/<topic>` に commit → push → PR。
4. **人手（ホスト）**: `database_id` を実 UUID に置換して push（エージェントに UUID を渡して置換させてもよい）。`ci.yml` の typecheck / build / test 化はエージェントが commit 済みのものを **ホストから push**（token に workflows 権限が無い）。
5. **人手（dash）**: リポ接続（Root directory = `apps/web`、API トークンは「新しいトークンを作成する」、非本番ブランチビルド OFF。上表の通り）。
6. **人手**: PR を merge → Workers Builds が走る → `curl https://kokemusu.shiraoka.workers.dev/health` → `{"status":"ok"}`、`/` → SPA HTML。ホストで `wrangler d1 migrations list kokemusu-db --remote` に `0000_init` が並ぶ。
7. 以降、ロジック（Phase 1）。

## 現在の状態

[status.md](status.md)（SessionStart hook がセッション開始時に注入）。履歴は [log.md](log.md) と git。
