# 技術選定

方針: **既存の好み（React 19 + Vite + TypeScript）に合わせる** ＋ **関数のみ・`class` を使わない**
（[[ts-functions-only-no-class]] のメモリ方針）＋ **セルフホストしやすい構成**。

## フロントエンド

- **React 19 + Vite + TypeScript**（既存プロジェクトと同じ）。
- スタイリング: Tailwind CSS（軽量・素早い）。または CSS Modules。
- 状態管理: まずは React 標準（hooks）＋ 必要なら軽量ライブラリ（Zustand など、関数志向）。
- 可視化: 重いライブラリを避け、自作 SVG/Canvas から。必要なら `visx` / `Observable Plot`。
- Markdown: パーサ ＋ **サニタイズ必須**（DOMPurify）。
- PWA / オフライン対応は後フェーズ（[roadmap](roadmap.md)）。

## バックエンド / API

- **Hono**（軽量・関数志向・`class` 不要）。
  - Cloudflare Workers でも Node でも動く ＝ **デプロイ先を後で選べる**。これが今回の肝。
- バリデーション: Zod（型と実行時検証を一致させる）。
- 認証: `@simplewebauthn/server`（パスキー）。詳細は [security.md](security.md)。

## データベース

- **SQLite 系**で統一（軽量・セルフホスト向き・1ユーザーに十分すぎる）。
  - 真のセルフホスト: `better-sqlite3` / libSQL（ファイル1つ。バックアップが楽）。
  - Cloudflare: **D1**（SQLite 互換）。
- ORM: **Drizzle**（関数志向・型安全・SQLite/D1 両対応）。または生 SQL ＋ 薄いヘルパ。
- マイグレーション管理（Drizzle Kit など）。

## デプロイ方式 ── ✅ 決定: 案A（Cloudflare Workers + D1）

**2026-06-05 決定: 案A で進める。** 理由: Cloudflare のセキュリティ基盤が堅牢で信頼できること、
Workers / D1 / WebAuthn を実地で扱うのが学習になること。
将来の案B（Docker）対応も視野に、コアは引き続きランタイム非依存（Hono ＋ Drizzle）で作る。

### 案A: Cloudflare Workers + D1（← 採用）

- 各自が自分の Cloudflare アカウントにデプロイ＝ある種のセルフホスト。
- **メリット**: サーバ保守ほぼゼロ、無料枠で足りる、HTTPS 自動、既存スキル
  （`cloudflare-workers-deploy-skeleton` で SPA+API+Cron を1 Worker・D1・GitHub Actions 自動デプロイ）が即使える。
- **デメリット**: データが Cloudflare 上に乗る → プライバシー懸念は本文のクライアント側暗号化(C)で緩和（[security.md](security.md)）。
- **注意**: WebAuthn の RP_ID（ドメイン）を最初に固定する（スキルの RP_ID ロックルール）。

### 案B: Docker（Node + Hono + SQLite ファイル）（推奨：プライバシー最優先）

- 自分の VPS / 自宅サーバで動かす。**データが完全に自分の手元**。最もプライバシー要件に忠実。
- **メリット**: データ主権、ファイル1つでバックアップ簡単、ホスティング非依存。
- **デメリット**: HTTPS・更新・公開設定など運用は自分持ち。配布物として `docker compose up` 一発を整える必要。

### 結論（決定済み）

- **案A（Cloudflare Workers + D1）を採用。** MVP はこれで素早く動かす（既存スキル活用・保守最小）。
- **コアはランタイム非依存に作る**（Hono ＋ Drizzle で SQLite/D1 を抽象化、ドメインロジックは純粋関数）。
  → 将来 **案B（Docker）を「真のセルフホスト」配布形態**として後から足せる。
- データが Cloudflare 上に乗る点は、本文のアプリ層/クライアント側暗号化で緩和していく（[security.md](security.md)）。

## コーディング方針

- **`class` を使わない。純粋関数 ＋ モジュールで構成**（[[ts-functions-only-no-class]]）。
- ドメインロジック（投稿・タグ・集計）は副作用のない純粋関数に寄せ、I/O は境界に押し出す。
- 型は厳密に（`strict` ON）。Zod スキーマから型を導出して二重定義を避ける。
- テスト: Vitest（ドメイン純粋関数と API 境界を重点的に）。

## 想定ディレクトリ構成

```
kokemusu/
├── apps/web/        # React 19 + Vite（SPA）
├── server/          # Hono（Workers/Node 両対応のエントリ）
├── packages/core/   # ドメインロジック：純粋関数（投稿・タグ・集計）
├── packages/db/     # Drizzle スキーマ & クエリ（SQLite/D1）
├── migrations/      # マイグレーション
└── docs/            # 本企画ドキュメント
```

> ※ monorepo にするか単一パッケージにするかは規模次第。MVP は単一パッケージ＋フォルダ分割でも可。
