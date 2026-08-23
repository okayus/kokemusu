---
status: accepted
date: 2026-08-23
---

# API 自動投稿は「受け側 PAT」。苔むすは送り側を知らない

別アプリ（最初は mazuoboeru の日次結果）が持ち主の代わりに苔片を作る入口として、**苔むすが設定画面で発行する
personal access token（`Authorization: Bearer`）** を採用する。苔むすが知るのは「どのユーザ・どのスコープ・
どのトークン名」だけで、送り側固有のフィールドや送り側の登録は持たない。`POST /api/posts` の body は
手動投稿と同じ（`title?` `body` `tags`）。

## Considered options

- **OAuth provider**（同意画面・client id・refresh token）: 第三者開発者向けの仕組み。自分のアプリ同士には過剰。
- **Cloudflare service binding**: 同一アカウント内限定。セルフホストされた苔むす（別アカウント）には結べない。
- **HMAC 署名 webhook**: 共有秘密という点は同じで、ユーザ・スコープ・失効 UI が無い分だけ劣る。
- **送り側の登録**（どのアプリが呼ぶかを苔むすが管理）: 送り側ごとの都合が受け側に漏れる。PAT の名前で足りる。

## Consequences

- 送り側は mazuoboeru に限らない（CLI・エージェント・別アプリ）。送り側が増えても受け側は変わらない。
- mazuoboeru 側は当面 **(i) 自分専用**: Worker Secret に苔むすの PAT を 1 本、Cron が日次で push
  （mazuoboeru 側の判断。per-user (ii) に広げても苔むすは無変更）。
- 生のトークンは発行時に一度だけ表示。失効は設定画面から。D1 には `sha256(token + pepper)` のみ。
- PAT では PAT を作れない（セッション必須）。CSRF の Origin チェックは Bearer を免除する。
- 送り側がリトライするなら `Idempotency-Key` を受け側で記憶する（必要になってから）。
