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
| [docs/dev-environment.md](docs/dev-environment.md) | 開発環境コンテナ・Cloudflare認証・デプロイ骨格（okayus-skills 調査） |
| [docs/data-model.md](docs/data-model.md) | データモデル |
| [docs/roadmap.md](docs/roadmap.md) | ロードマップ（MVP → 拡張） |

## 想定ディレクトリ構成（実装時）

```
kokemusu/
├── docs/              # この企画ドキュメント群
├── apps/
│   └── web/           # React 19 + Vite フロントエンド
├── server/            # Hono API（Workers / Node 両対応）
├── packages/
│   └── core/          # ドメインロジック（純粋関数・ランタイム非依存）
└── migrations/        # DB スキーマ（SQLite / D1）
```

## ステータス

🌱 **企画段階** ── アイデアをまとめ、デプロイ方式は **案A（Cloudflare Workers + D1）** に決定。
次は Phase 0 スキャフォールド。残りの未決定事項は [docs/roadmap.md](docs/roadmap.md) の「決めること」を参照。
