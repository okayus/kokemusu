# ログ（追記専用・新しい順）

1 行 = 1 節目（PR の merge・ADR・人手作業の完了・本番の状態変化）。`- YYYY-MM-DD 何を（#PR / ADR / skill）`。
自動ロードはされない。必要なら `head -20 docs/log.md`。作業中の試行錯誤は書かない（git log と PR にある）。

- 2026-08-23 push 起動の Workers Builds を実証（`main` の #7 / #8 / #9 の各 commit に check-run `Workers Builds: kokemusu` が success）。Phase 0 の残件が消えた
- 2026-08-23 対話シェルを `op run` で包むのをやめ（TTY が壊れる）、`shell.sh` に TTY 判定と `op://` パーサの堅牢化、`.claude/settings.json` の deny の穴（refspec 形の push / ブランチ削除）を塞ぐ（#8 / #9）
- 2026-08-23 最初の縦切り「投稿 → タグ → ヒートマップに 1 マス点く」を PR1〜6 に分割（`docs/plans/vertical-slice.md`）。決めること 4（UI トーン）・6（タグ構造）・9（集計の「日」）を確定、`RP_ID = kokemusu.shiraoka.workers.dev` を永久固定、GitHub token を `./shell.sh` の exec 時シェルへ移動（#7）
- 2026-08-23 進捗管理を status hub 化: `docs/status.md`（40 行上限）+ `docs/log.md` + SessionStart hook + `/handoff` + CI の上限検査。CLAUDE.md を規約のみに圧縮（#6）
- 2026-08-23 Workers Builds 接続完了。本番 `/health` 200・SPA 配信・`0000_init` 適用。My Profile で作った手作りトークンは picker に出ず「新しいトークンを作成する」で生成（skill `cloudflare-workers-builds-keyless-deploy` 0.3.0 = okayus-skills #24）。push 起動のビルドは未実証
- 2026-08-23 #3（docs drift）・#5（grill: ADR-0001 本文暗号化 / ADR-0002 受け側 PAT / `CONTEXT.md`）・#4（歩く骨格 `apps/web`、CI を typecheck/build/test 化、`database_id` 実 UUID）を merge
- 2026-08-22 サンドボックス再同期（node:24）・1 リポ限定 PAT を 1Password で注入（`./up.sh`）・MCP（cloudflare-docs / context7）・docs egress 10 ドメイン・`modern-web-guidance` 同梱・CI placeholder・`main` ruleset。E2E は #1、docs は #2
- 2026-06-05 デプロイ方式 = Cloudflare Workers + D1 に決定（roadmap「決めること」1）
