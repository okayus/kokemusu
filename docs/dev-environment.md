# 開発環境・デプロイ基盤（okayus-skills 調査メモ）

`okayus-skills` を調査し、苔むす（案A: Cloudflare Workers + D1）に適用できる構成をまとめる。
これらのスキルは production パターンの抽出で、苔むすのセキュリティ要件と非常に相性が良い。

## 使うスキルとフェーズ対応

| スキル | 用途 | 苔むすでの使いどころ |
| --- | --- | --- |
| `claude-code-docker-sandbox` | 開発をegressファイアウォール付きDockerに隔離 | **Phase 0 最初**。npm/エージェント実行をホストから隔離 |
| `cloudflare-workers-deploy-skeleton` | SPA+API+Cron を1 Worker・D1・GH Actionsで自動デプロイ | **Phase 0** 骨格構築 |
| `cloudflare-api-token-permissions` | CIデプロイ用APIトークンの権限マッピング | **Phase 0** CI認証設定／binding追加時の診断 |
| `cloudflare-d1-drizzle-migration` | D1でdrizzle-kitマイグレを安全に | **Phase 1** 実スキーマ投入時（必読） |
| `cloudflare-workers-e2e-playwright` | Workers+Vite+HonoのPlaywright e2e | **Phase 1** WebAuthn含むe2e（仮想authenticator） |
| `cloudflare-workers-bot-scan-defense` | 公開直後のbotスキャン耐性・認証routeのレート制限 | **Phase 1〜** 認証 begin/verify のレート制限 |
| `cloudflare-d1-weekly-backup-via-pr` | D1を毎週バックアップしPRで保存 | **Phase 3** バックアップ |
| `cloudflare-cron-to-discord` | Cron→Discord通知 | 任意（リマインド等を作るなら） |
| `cloudflare-workflows-for-long-tasks` | 30秒超の処理をWorkflowへ | 当面不要（重い処理が出たら） |

## 1. 開発環境コンテナ（claude-code-docker-sandbox）

**狙い**: npm の postinstall 等のサプライチェーン攻撃を、デフォルト拒否のegressファイアウォール付きコンテナに封じ込める。`npm install` もエージェント実行もコンテナ内、ホストの `~/.ssh` や認証情報には触れない。プライベート日記＝セキュリティ厳重、という方針に直結。

- 構成3ファイル: `.docker/Dockerfile`（Anthropic公式devcontainer image: node:20, 非root `node`ユーザ）、`.docker/init-firewall.sh`（egress許可リスト）、`docker-compose.yml`（VS Code非依存、任意のホストエディタをbind mount）。
- **egress許可リスト**（苔むす向け）:
  - `registry.npmjs.org`（npm install 必須）
  - `api.anthropic.com`（Claude Code がモデルに到達）
  - `api.cloudflare.com` / `dash.cloudflare.com` / `workers.cloudflare.com`（Cloudflareデプロイ）
  - GitHub IPレンジは動的取得される
  - **不要なドメインは消す**（VS Code / Statsig / Sentry 等を残すとDNS失敗でコンテナごと落ちる "telemetry-domain DNS trap"）。`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` を設定。
- **境界の鉄則**: `git commit`/`push` は**ホスト側**で行う（GitHubトークンを隔離境界に入れない）。コンテナ内からは `.git` をbind mountして `git status`/`log` の閲覧のみ。
- **build-time と runtime のネットワーク区別**: ファイアウォールはentrypoint（`up`時）。ツールチェーン導入は`build`時で素通り。苔むすはTSのみなのでRust/Haskellの build-arg は不要。
- **限界**: 許可ドメイン経由の流出やカーネル攻撃は防げない。許可リストは狭く保つ。真に信頼できないコードはVM/microVMで。

> 完了条件: `docker compose up -d` のログに「Firewall verification passed」2行 → `example.com` は `000`（遮断）、`registry.npmjs.org` は `200`。コンテナ内 `claude` で認証でき、`down/up` 後も保持される。

## 2. Cloudflare の認証方式（2系統あるので注意）

「Cloudflareの認証方式」には **(a) デプロイ用の認証** と **(b) アプリのユーザ認証** の2つがある。苔むすは両方使う。

### (a) Cloudflare へのデプロイ認証

- **ローカル**: `wrangler login`（OAuth, フルアカウントアクセス）。権限の悩みは出ない。
- **CI（GitHub Actions）**: `CLOUDFLARE_API_TOKEN`（＋`CLOUDFLARE_ACCOUNT_ID`）。**狭い権限のカスタムトークン**を使う。
- **苔むすの最小トークン権限**（SPA+API+D1構成）:
  - `Account / Workers Scripts / Edit`
  - `Account / D1 / Edit`
  - `Account / Account Settings / Read`
  - （skeleton では `User Details / Read` も）
  - Account Resources は自分のアカウントに限定（All accounts にしない）
- ⚠️ **「Edit Cloudflare Workers」テンプレートを使わない**。D1 / R2 / Queues が**黙って欠落**しており、CIで `wrangler d1 migrations apply --remote` が `code: 7403` で落ちる。**Create Custom Token** で必要分を選ぶ。
- 権限編集はトークン値を変えない（**Edit**であって**Roll**でない）→ GitHub Secret の更新不要。binding追加で `code: 10000/7403/9106` が出たら `cloudflare-api-token-permissions` の表で引く。

### (b) アプリのユーザ認証（パスキー / WebAuthn）

- 苔むすは単一ユーザのプライベート日記 → **パスキー（WebAuthn）**が最適（[security.md](security.md)）。
- ⚠️ **RP_ID ロックルール**: RP_ID（ホスト名）は**初回デプロイで固定**。後で変えると登録済みパスキーが全部無効。
  - **決定済み: RP_ID = `<project>.workers.dev` サブドメイン**（[tech-stack.md](tech-stack.md)）。day 1 から固定し、永続として扱う。
  - skeleton の `wrangler.jsonc` の `RP_ID` / `ORIGIN` を本番ホスト名に設定 → デプロイ。
- e2e は `cloudflare-workers-e2e-playwright` の **WebAuthn仮想authenticator** で register/login の配線まで実テスト（`DEV_BYPASS_USER_ID` で逃げない）。

## 3. デプロイ骨格（cloudflare-workers-deploy-skeleton）

ゴール: **`main` push → 本番URLが `/health` 200 ＆ SPA HTMLを返す**、ビジネスロジック=ゼロの「歩く骨格」。

- **3層SPAルーティング**（どれか欠けると `/` が404）:
  - L1 `wrangler.jsonc`: `assets.not_found_handling: "single-page-application"`
  - L2 `wrangler.jsonc`: `assets.run_worker_first: true`（後で secureHeaders がSPA HTMLを包める）
  - L3 `worker/index.ts`: `app.notFound` で `c.env.ASSETS.fetch` に委譲
- コピー元テンプレ: `wrangler.jsonc` / `worker/{index,cron,types}.ts` / `deploy.yml` / tsconfig+vite / 空の `drizzle/0000_init.sql` / `.dev.vars.example`。
- **ハマりどころ**:
  - `pnpm deploy` が pnpm 組込みと衝突 → root の `package.json` で `"deploy": "pnpm --filter <pkg> run deploy"`（明示 `run`）。
  - `database_id` の `<placeholder>` 放置で失敗 → `wrangler d1 create` 直後に実UUIDへ置換。
  - `@cloudflare/vite-plugin@0.1.x` は dev で `/__scheduled` を未ルーティング（Cron dev検証は `cloudflare-cron-to-discord` のfallback）。
- **スコープ外（骨格では作らない）**: 認証・secureHeaders/CSP・ドメインスキーマ・drizzle本体。**デプロイが通ってからロジックを載せる**。

## セットアップ順（苔むす Phase 0）

1. **コンテナ先**: `claude-code-docker-sandbox` の3ファイルを配置 → `docker compose build && up -d` → ファイアウォール検証。以降の作業はコンテナ内。
2. **ユーザ操作（対話）**: `wrangler login` → `wrangler d1 create kokemusu-db`（`database_id` UUID控え）。
3. **ユーザ操作**: Custom Token を上記の最小権限で作成 → GitHub Secret `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。
4. **エージェント**: skeleton テンプレ生成（`database_id` 即置換）。`RP_ID`/`ORIGIN` は workers.dev 本番ホスト名で固定。
5. **エージェント**: `pnpm install` → `check` → ローカルマイグレ → dev確認。
6. **エージェント**: commit（ホスト側push）→ PR → merge → GH Actions グリーン → 本番URLで `/health` 200 確認。

> ※ 現在エージェントはホスト上で動作中。サンドボックス運用にするなら「コンテナを立てて、その中で `claude` を動かす」ワークフローへの切替が必要（要相談）。

## 現在の状態（2026-06-05 構築済み）

サンドボックスを構築・起動・検証済み。

- 配置: `.docker/Dockerfile` / `.docker/init-firewall.sh` / `docker-compose.yml`（egress許可リストは npm/anthropic/cloudflare のまま、Rust/Haskell は false）。
- イメージ `kokemusu-dev:latest` ビルド済み。コンテナ `kokemusu-dev` 起動中。
- **ポート**: ホスト `5173` は別プロジェクト（`todo-web-dev-1`）が使用中だったため、**ホスト側を `5273` に変更**（`5273:5173`）。コンテナ内 Vite は 5173、ブラウザからは `http://localhost:5273`。
- **ファイアウォール検証 OK**: `example.com` → `000`（遮断）、`registry.npmjs.org` → `200`、`api.cloudflare.com` → `404`（到達可）、`api.github.com` 到達可。
- コンテナ内: 実行ユーザ `node`、`/workspace` に bind mount 済み、`node v20.20.2` / `git` / `gh` / `claude 2.1.x` 導入済み。
- **pnpm は未導入**（skeleton で使う）。コンテナ内で `corepack enable pnpm`（または `npm i -g pnpm`）で有効化する。corepack は npmjs から取得＝許可済み。

### コンテナ内 Claude のコンテキスト（モデルA採用）

開発は**コンテナ内の `claude`** で行う（モデルA）。コンテナは別インスタンスなので、ホストの設定は継承されない。
橋渡しとして以下を用意済み:

- **`CLAUDE.md`（プロジェクトルート）**: `/workspace` 直下にあり自動ロードされる。概要・確定済み決定・働き方の規約（関数のみ/classなし、git はホスト側、骨格優先）・docs目次・参照スキル一覧を集約。
- **スキル**: `okayus-skills` はマウント外で見えないため、`docker-compose.override.yml`（**gitignore対象・ローカル専用**）で
  `../okayus-skills/skills` を `/home/node/.claude/skills:ro` に**読み取り専用マウント**。単一ソース（コピーせずdriftなし）。
  → コンテナ内 `claude` から cloudflare-* / sandbox の9スキルが**スキルとして**認識される（検証済み）。
  コミット対象の `docker-compose.yml` はセルフホスト配布用に汚さない。
- **継承されないもの（割り切り）**: この会話の履歴、ホストの自動メモリ（要点は `CLAUDE.md` に転記）、ホスト側の他スキル（kokemusu に無関係）。

### 次にやる対話ステップ（ユーザ操作）

1. コンテナ内で Claude Code 認証（初回のみ。`/home/node/.claude` は named volume で永続）:
   ```sh
   docker compose exec dev zsh
   # in-container:
   claude
   #   表示されたURLをホストのブラウザで開く → 承認 → 出たコードを貼り戻す
   #   /status で account と model を確認
   ```
2. その後、コンテナ内で deploy-skeleton 構築へ（`wrangler login` / `wrangler d1 create kokemusu-db` / Custom Token 作成）。

### 日常運用

- 起動: `docker compose up -d` ／ シェル: `docker compose exec dev zsh` ／ 停止: `docker compose stop`。
- `git commit`/`push` は**ホスト側**で（トークンを境界に入れない）。コンテナ内は閲覧のみ。
- `.docker/*` や `docker-compose.yml` を変えたら `docker compose down && build && up -d`。`down -v` は認証も消える。
