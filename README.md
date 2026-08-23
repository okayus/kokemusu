# 苔むす (kokemusu)

> 日々の小さな投稿が、苔のように静かに積み上がっていく ── 自分だけの日記アプリ。

ツイート感覚で1日に何度でも投稿し、それぞれにタグ（`英語` `typescript` `ファイナンス` など）を付ける。
投稿はタグごとに積み上がり、「これまで自分が何をしてきたか」をグラフィカルに振り返れる。

**ソーシャル機能はない。完全に自分のためだけのアプリ。** 使いたい人はそれぞれが自分でセルフホストする。
プライベートな内容も書くため、セキュリティは厳重にする。

---

## コンセプト要約

- **気軽さ**: 下書きも投稿ボタンへの気構えもいらない。ツイートのように脊髄反射で書く。
- **積み上げ**: 1投稿は小さな「苔片」。タグという石の上に、時間をかけて苔が生していく。
- **振り返り**: タグ別ヒートマップや累積グラフで、自分の歩みが視覚的に見える。
- **静けさ**: いいねもフォロワーも通知もない。誰にも見せない、自分だけの庭。
- **主権**: データは自分の手元に。各自がセルフホストし、暗号化で守る。

名前の由来は [docs/concept.md](docs/concept.md) を参照。

---

## ドキュメント

| ファイル | 内容 |
| --- | --- |
| [docs/concept.md](docs/concept.md) | 名前の由来・メタファー・コア体験 |
| [docs/features.md](docs/features.md) | 機能仕様（投稿・タグ・タイムライン） |
| [docs/visualization.md](docs/visualization.md) | 可視化のアイデア（核心） |
| [docs/security.md](docs/security.md) | セキュリティ・プライバシー設計 |
| [docs/tech-stack.md](docs/tech-stack.md) | 技術選定とデプロイ方式 |
| [docs/dev-environment.md](docs/dev-environment.md) | 開発サンドボックス・GitHub token 注入・Workers Builds キーレスデプロイ・デプロイ骨格 |
| [docs/data-model.md](docs/data-model.md) | データモデル |
| [docs/roadmap.md](docs/roadmap.md) | ロードマップ（MVP → 拡張） |
| [docs/status.md](docs/status.md) | **いま**のハブ（40 行上限。次の 3 手・詰まり・進行中 PR。セッション開始時に自動注入） |
| [docs/log.md](docs/log.md) | 節目のログ（追記専用・新しい順・1 行 1 節目） |

## ディレクトリ構成

```
kokemusu/
├── apps/web/            # 1 Worker に全部: React 19 + Vite の SPA（src/）＋ Hono API / Cron（worker/）
│   ├── drizzle/         #   D1 マイグレーション（wrangler d1 migrations apply）
│   └── wrangler.jsonc   #   Worker 名 kokemusu・3 層 SPA ルーティング・D1・Cron・RP_ID
├── packages/            # （予定）core = ドメインロジックの純粋関数。ロジックが生えた時点で切る
├── docs/                # この企画ドキュメント群
├── .docker/ + up.sh + shell.sh  # 開発サンドボックス（docker-compose.yml と合わせて。token は shell.sh で注入）
└── .github/workflows/   # ci.yml = typecheck / build / test（デプロイは Workers Builds、GitHub に秘密なし）
```

pnpm workspace。`pnpm dev`（コンテナ内 5173 → ホスト 5273）/ `pnpm check` / `pnpm test` / `pnpm build` はルートから。

## ステータス

🌱 **Phase 0（土台）** ── 企画 docs、開発サンドボックス、public リポ ＋ `main` ruleset、**デプロイ骨格（`apps/web`、ロジック = ゼロ）** まで。
次は人手で Cloudflare 側（`wrangler d1 create kokemusu-db` → Workers Builds 接続）→ `https://kokemusu.shiraoka.workers.dev/health` が 200 になったら Phase 1。
未決定事項は [docs/roadmap.md](docs/roadmap.md) の「決めること」を参照。
