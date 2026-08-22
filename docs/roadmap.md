# ロードマップ

「動くものを早く」→「振り返りが楽しい」→「堅牢・安心」の順で育てる。
苔のように、まず生やしてから厚くしていく。

## Phase 0 — スキャフォールド（土台）

> 配線の詳細と人手 / エージェントの分担は [dev-environment.md](dev-environment.md) を参照。

- ~~開発サンドボックス（node:24・egress firewall・1Password からの GitHub token 注入・docs MCP・`modern-web-guidance`）、public リポ、`main` ruleset（PR 必須・required check `ci`・force push 禁止・bypass なし）~~ → **完了（2026-08-22）**。
- **デプロイ骨格**（`cloudflare-workers-deploy-skeleton`、wrangler 4 / `@cloudflare/vite-plugin` 1.x）: `apps/web` に SPA + API + Cron を 1 Worker で、空の D1 マイグレ込み。**ビジネスロジック = ゼロ**。
- **デプロイ経路 = Workers Builds（キーレス）**: GitHub に Cloudflare トークンを置かない。人手で `wrangler login` → `wrangler d1 create kokemusu-db` → リポ接続（D1 Edit 入りカスタムビルドトークン・Root directory `apps/web`・非本番ブランチビルド OFF）。`deploy.yml` は作らない。
- `.github/workflows/ci.yml` を placeholder から typecheck / build / test に置換（人手でホストから push）。
- **完了条件**: `main` merge → `https://kokemusu.shiraoka.workers.dev/health` 200 ＆ `/` が SPA HTML、`wrangler d1 migrations list kokemusu-db --remote` に `0000_init`。
- `RP_ID = kokemusu.shiraoka.workers.dev` を `wrangler.jsonc` の `vars` に day 1 で固定（認証そのものは Phase 1。骨格には載せない）。
- `packages/core`（純粋関数のドメインロジック）はロジックが生えた時点で切る（空パッケージは作らない）。

## Phase 1 — MVP（毎日使える最小形）

ゴール: **自分が毎日投稿して、最低限の苔（ヒートマップ）を眺められる。**

- DB スキーマとマイグレーション（[data-model.md](data-model.md)）。実スキーマ投入前に `cloudflare-d1-drizzle-migration` 必読。
- 投稿 CRUD（作成・編集・ソフトデリート、Markdown ＋ サニタイズ、任意の `title`）。
- タグ付与・補完、多対多。
- タイムライン（新着順、タグ絞り込み、期間）。
- **タグ別ヒートマップ**（可視化1種）。
- **パスキー認証（single-user）**: `INITIAL_REGISTRATION_TOKEN` で一度だけ登録を開けて閉じる、端末 2 台登録、リカバリ runbook。安全な Cookie/セッション、HTTPS/HSTS、CSP、認証 route のレート制限（`cloudflare-workers-bot-scan-defense`）。
- WebAuthn 仮想 authenticator の e2e（コンテナ内）。
- 本文/メタデータ分離の設計だけ仕込む（暗号化は後でも入れられるように）。

## Phase 2 — 振り返りを豊かに

- **API 自動投稿（PAT）**: `POST /api/posts` を `post:write` で開け、設定画面でトークン発行・失効（[features.md](features.md) §7、`cloudflare-workers-pat-bearer-auth`）。最初の送り側 = mazuoboeru の日次結果投稿。Phase 1 の直後に着手可。連携の形 (i)/(ii) は「決めること」8。
- 全文検索。
- 累積（積み上げ）グラフ、ストリーク、内訳・時間帯分布。
- **タグ関係グラフ**（共起ネットワーク、[visualization.md](visualization.md) §6）。
- タグ運用（リネーム・統合・別名・アーカイブ・色/絵文字）。
- 振り返りサマリー（週/月）。
- エクスポート（JSON / Markdown）。

## Phase 3 — 堅牢・安心

- 本文のアプリ層暗号化(B)、必要ならクライアント側暗号化(C)（「決めること」2 の結論に従う）。
- D1 バックアップ: **public リポなので「git に commit」変種は不可** → keyless 変種（ホスト timer か Worker→R2）を skill 側に足してから。暗号化バックアップ。
- インポート、ログイン履歴 UI。
- セルフホスト配布物の整備（案B: `docker compose up` 一発、セットアップ/運用ドキュメント）。

## Phase 4 — 世界観と快適さ

- **苔の庭ビュー**（メタファー象徴ビュー）。
- 「今年の苔むす」年次まとめ、On this day。
- PWA / オフライン、モバイル最適化、キーボードショートカット拡充。
- 画像・ファイル添付。

---

## 決めること（未決定事項）

実装に入る前にここを確定させたい。未決のものは `/grill-with-docs` で詰め、結論は `CONTEXT.md` / `docs/adr/` に残す。

1. ~~**デプロイ方式**~~ → ✅ **案A Cloudflare Workers + D1**（2026-06-05）、**経路は Workers Builds キーレス**（2026-08-22）。
   ✅ 本番ドメイン = **`kokemusu.shiraoka.workers.dev`** で確定（RP_ID もこれ）。custom domain へ移るなら**初回パスキー登録より前**。
2. **暗号化レベル**: MVP は (A) インフラ暗号化のみ？ 本文暗号化(B)/E2E(C) はいつ入れる？（全文検索の方式と `title` の扱いに影響）→ **未決（grill）**
3. ~~**認証方式**~~ → ✅ **パスキーのみ（single-user。パスワード / TOTP は作らない）＋ API は PAT**（2026-08-22）。リカバリ = 端末 2 台登録 ＋ 自分（操作者）が `INITIAL_REGISTRATION_TOKEN` を再発行して新しいパスキーを登録する runbook。
4. **UI トーン**: 苔の世界観をどこまで前面に出すか（情緒重視 ↔ 実用ミニマル）。
5. ~~**monorepo にするか**~~ → ✅ **pnpm workspace**。まず `apps/web` の単一パッケージ、`packages/core` はロジックが生えたら。
6. **タグの構造**: フラットで開始。階層化は必要が出てから。
7. **`post.title` の位置づけ**: API 自動投稿の機械的な見出し専用か、手動投稿にも開くか、暗号化対象に含めるか、一覧 / 検索でどう使うか。→ **未決（grill）**
8. **mazuoboeru 連携の形**: (i) 自分専用（mazuoboeru の Worker Secret に PAT 1 本、Cron が日次 push）か、(ii) per-user（mazuoboeru の各ユーザが自分の苔むす PAT を登録。送り側に暗号化保存・配送台帳が要る）か。受け側の作りは同じ。→ **未決（grill）**

## 次のアクション候補

- [ ] Phase 0 人手: `wrangler login` → `wrangler d1 create kokemusu-db` → Workers Builds 接続。
- [ ] 骨格 PR を merge → `/health` 200 を確認。
- [ ] `/grill-with-docs` で 2・7・8 を確定 → `CONTEXT.md` / ADR。
- [ ] 最初の縦切り: 「投稿 → タグ → ヒートマップに1マス点く」を一本通す。
