# ロードマップ

「動くものを早く」→「振り返りが楽しい」→「堅牢・安心」の順で育てる。
苔のように、まず生やしてから厚くしていく。

## Phase 0 — スキャフォールド（土台）

**完了（2026-08-23）**。サンドボックス・token 注入・MCP・`main` ruleset（08-22）→ 歩く骨格 `apps/web`（#4）→ Workers Builds キーレス接続・本番 `/health` 200・`0000_init` 適用（08-23）。経緯は [log.md](log.md)、再現手順は [dev-environment.md](dev-environment.md)。`RP_ID` は `wrangler.jsonc` に day 1 で固定済み。`packages/core` はロジックが生えた時点で切る（空パッケージは作らない）。

## Phase 1 — MVP（毎日使える最小形）

ゴール: **自分が毎日投稿して、最低限の苔（ヒートマップ）を眺められる。**
最初の縦切り「投稿 → タグ → ヒートマップに 1 マス点く」は **完了（2026-09-02、DoD 1〜5 全通過。[log.md](log.md)。plans/vertical-slice.md は削除済み＝ git 履歴）**。e2e（PR6、#26）も 2026-09-02 に完了。タグ絞り込み UI（チップ / §8 フォーカス / §6 橋 の 3 導線、`?tags=` AND を posts にも）は 2026-09-03 に完了。投稿の編集・削除（物理削除 — [ADR-0003](adr/0003-post-delete-is-physical.md)）は 2026-09-04 に完了（#34）。Markdown 描画（サニタイザではなく React 要素へ — [ADR-0004](adr/0004-markdown-renders-to-react-elements.md)）も 2026-09-04 に完了。期間絞り込み UI（`?from=`/`?to=` ＋ 今日 / 今週 / 今月 / 今年 ＋ カスタム範囲）も 2026-09-05 に完了 — **Phase 1 の取りこぼしは無し**。

- DB スキーマとマイグレーション（[data-model.md](data-model.md)）。実スキーマ投入前に `cloudflare-d1-drizzle-migration` 必読。
- 投稿 CRUD（作成・編集・削除 [物理削除、[ADR-0003](adr/0003-post-delete-is-physical.md)]、Markdown 描画 [[ADR-0004](adr/0004-markdown-renders-to-react-elements.md)]、任意の `title`）。
- タグ付与・補完、多対多。
- タイムライン（新着順、タグ絞り込み、期間）。
- **総草ヒートマップ**（可視化1種。タグ別ヒートマップは作らない — [visualization.md](visualization.md) §1、2026-09-02）。
- **パスキー認証（single-user）**: `INITIAL_REGISTRATION_TOKEN` で一度だけ登録を開けて閉じる、端末 2 台登録、リカバリ runbook。安全な Cookie/セッション、HTTPS/HSTS、CSP、認証 route のレート制限（`cloudflare-workers-bot-scan-defense`）。
- ✅ WebAuthn 仮想 authenticator の e2e（コンテナ内、#26）。
- **本文のアプリ層暗号化 (B)**: 最初の実データより前に。`BODY_KEY`（Worker Secret、1Password にも控える）、メタデータは平文、検索は復号して走査（[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)）。

## Phase 2 — 振り返りを豊かに

- ✅ **API 自動投稿（PAT）**（#31、2026-09-03）: `POST /api/posts` を `post:write` で開け、設定画面でトークン発行・失効（[features.md](features.md) §7、`cloudflare-workers-pat-bearer-auth`）。最初の送り側 = mazuoboeru の日次結果投稿。連携の形 (i)/(ii) は「決めること」8。
- 全文検索。
- ✅ **タグ関係グラフ**（#32、2026-09-03。共起ネットワーク。石＝タグが投稿数で育つ、[visualization.md](visualization.md) §6）。
- ✅ **タグのタイムライン**（#30、2026-09-03。最初〜最後の苔片の期間、[visualization.md](visualization.md) §8）。
- ✅ **書く面をダイアログへ、トップは振り返りに**（2026-09-05。sticky ヘッダーの「積む」/ `n` で開くネイティブ `<dialog>`、
  見出しトグル、苔片の「同じ石に積む」— [features.md](features.md) §1 / §3、[CONTEXT.md](../CONTEXT.md)）。
- **過去に積む・続く苔片・向き**（2026-09-06 決定、[ADR-0005](adr/0005-post-axis-is-day-range.md)。順番は
  A1 軸を「日」に → B 向き → A2 過去に積む — [plans/day-axis-and-kind.md](plans/day-axis-and-kind.md)）。
- 累積（積み上げ）グラフ、ストリーク、内訳・時間帯分布。
- タグ運用（リネーム・統合・別名・アーカイブ・色/絵文字）。
- 振り返りサマリー（週/月）。
- エクスポート（JSON / Markdown）。

## Phase 3 — 堅牢・安心

- ~~本文のアプリ層暗号化(B)~~ → Phase 1 に前倒し（ADR-0001）。端末側 E2E (C) は採用しない。鍵ローテーション手順（`k2` を足して順次再暗号化）。
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
   ✅ 本番ドメイン = **`kokemusu.shiraoka.workers.dev`** で確定（RP_ID もこれ）。
   ✅ **2026-08-23: custom domain を待たず `RP_ID` を永久固定してよい**と判断。独自ドメインを取る可能性は残るが、
   その場合もログインの origin は `workers.dev` のまま（RP_ID は origin の登録可能サフィックスである必要があるため）。
   どうしても移るなら「`RP_ID`/`ORIGIN` 変更 → 既存パスキー無効 → `INITIAL_REGISTRATION_TOKEN` 再発行 → 端末 2 台を再登録」で、
   **既存の `user` 行に `credential` を足す**（新しい user を作らない = 苔片が孤児にならない）。
2. ~~**暗号化レベル**~~ → ✅ **(B) アプリ層の本文暗号化を Phase 1 から、鍵は Worker Secret。(C) は不採用**（2026-08-23、[ADR-0001](adr/0001-body-encrypted-at-app-layer.md)）。全文検索は復号して走査。`title` も本文と同じく暗号化。
3. ~~**認証方式**~~ → ✅ **パスキーのみ（single-user。パスワード / TOTP は作らない）＋ API は PAT**（2026-08-22）。リカバリ = 端末 2 台登録 ＋ 自分（操作者）が `INITIAL_REGISTRATION_TOKEN` を再発行して新しいパスキーを登録する runbook。
4. ~~**UI トーン**~~ → ✅ **ミニマル ＋ 苔の言葉と色**（2026-08-23）。骨格は実用ミニマルのまま、苔らしさは用語（苔片）・
   空状態のコピー・苔の配色トークン（ライト/ダーク）で出す。動きは「投稿後にマスが濃くなる」1 箇所だけ。情緒の主役は Phase 4 の苔の庭ビュー。
5. ~~**monorepo にするか**~~ → ✅ **pnpm workspace**。まず `apps/web` の単一パッケージ、`packages/core` はロジックが生えたら。
6. ~~**タグの構造**~~ → ✅ **フラット確定。表記ゆれは `tag.norm`（`trim` ＋ NFKC ＋ 小文字化、`(user_id, norm)` で一意）で吸収**
   （2026-08-23）。階層は作らない —— タグ同士の関係は共起グラフで見る（[visualization.md](visualization.md) §6）。
7. ~~**`post.title` の位置づけ**~~ → ✅ **任意の見出し。手動でも API でも付けられ、UI は既定で隠す**（フォームは本文 1 欄のまま、ショートカット / トグルで見出し欄を出す。タイムラインは見出しのある苔片だけ本文の上に小さく表示。検索は見出しも復号走査に含める。暗号化は本文と同じ鍵）（2026-08-23）。
8. ~~**mazuoboeru 連携の形**~~ → ✅ **(i) 自分専用**（mazuoboeru の Worker Secret に苔むすの PAT を 1 本、Cron が日次 push）。受け側は汎用のまま＝送り側を知らない設計を [ADR-0002](adr/0002-api-posting-via-receiver-side-pat.md) に記録。per-user (ii) は他の mazuoboeru ユーザが苔むすをセルフホストしたら mazuoboeru 側だけで足す（2026-08-23）。

9. ~~**集計の「日」**~~ → ✅ **`Asia/Tokyo` 定数で切る**（2026-08-23、[data-model.md](data-model.md)）。`user` に TZ 列は持たず、
   見る場所で過去のマスが動かないことを優先。設定化は後から NULLABLE 列 / API パラメータで足せる。
10. ~~**苔片の軸（過去に積む・期間で積む）**~~ → ✅ **`created_at` ではなく「日」の範囲 `first_day` / `last_day`（日本時間の文字列、NOT NULL）。
    続く苔片は「在った 1 片」として各日に数える**（2026-09-06、[ADR-0005](adr/0005-post-axis-is-day-range.md)）。`post` の唯一の
    再構築をデータが少ないうちに行う。用語は [CONTEXT.md](../CONTEXT.md)「続く苔片」。
11. ~~**インプット／アウトプットの持ち方**~~ → ✅ **タグではなく `post.kind` 列（`input` / `output` / `both`、null ＝ 未分類）。
    総草は濃さ ＝ 件数のまま、色相 ＝ 向き（青緑／赤茶／緑）**（2026-09-06、[CONTEXT.md](../CONTEXT.md)「向き」）。組み込みタグに
    すると §6 の石のつながりが 2 つの巨大な石に潰れ、§1「タグで分けない」にも抵触する。

## 次のアクション

[status.md](status.md) の「次の 3 手」が正。ここには書かない。
