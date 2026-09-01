# ログ（追記専用・新しい順）

1 行 = 1 節目（PR の merge・ADR・人手作業の完了・本番の状態変化）。`- YYYY-MM-DD 何を（#PR / ADR / skill）`。
自動ロードはされない。必要なら `head -20 docs/log.md`。作業中の試行錯誤は書かない（git log と PR にある）。

- 2026-09-01 縦切り PR4 merge: 投稿 API + 最小タイムライン（#20。post + 新規 tag + post_tags を原子的 db.batch・タグは norm で dedupe・keyset カーソル・`/api/*` に no-store・⌘/Ctrl+Enter と localStorage 退避の 1 欄コンポーザ）。人手の BODY_KEY 設定と本番投稿の動作確認まで完了 = **DoD 1〜3 通過**、D1 に平文ゼロはローカル実証（本番の封筒目視 = DoD 5 は次の 3 手）
- 2026-09-01 縦切り PR3 merge: 本文暗号化コア（#19、ADR-0001）— AES-256-GCM・封筒 `k1.<iv>.<暗号文>`・鍵は引数で受ける純粋関数のみ・BODY_KEY 未設定/不正は fail closed
- 2026-09-01 PR2 の本番検証完了: 端末 2 台のパスキー登録・ログイン往復・`INITIAL_REGISTRATION_TOKEN` 削除で登録の扉を閉じた（外形も実測: 未認証 `me` 401 / `register/begin` 403 / `login/begin` 200）。**RP_ID = kokemusu.shiraoka.workers.dev はこれで確定**。secret put のパイプ形は値が画面に出ない罠 → 2 段形に訂正（#14 コメント）
- 2026-08-29 merge を `gh pr merge --auto --squash` の opt-in へ（例外あり、CLAUDE.md）、ci.yml を安定シェル化（`.node-version` / root `ci` script / Dependabot、#16）。matatabetai（ADR-001 改訂 2026-08-24）と okayus-skills token skill 0.2.4 に追随。5 日間 merge 待ちだった #15 は 2026-08-29 にホストで merge
- 2026-08-29 本番だけ verify 系が全部 500 → hotfix #15: hono は `__Host-` cookie の**削除**にも secure を要求して throw する（`consumeChallenge` の deleteCookie が漏れ。http のローカル / 単体テストは素の cookie 名で発火しない）。削除を `clearCookie()` に一元化し、https ORIGIN の回帰テスト 3 件を追加。skill passkey-auth の参照コードにも同罠 = 書き戻し対象
- 2026-08-24 縦切り PR2 merge: パスキー認証 single-user 変種（`user` 行が既にあれば credential を足すだけ = 苔片を孤児にしない）+ secureHeaders / CSP（vite dev の HMR とは `DEV_CSP=1` で分離）+ CSRF Origin 検査 + ratelimits / observability + 最小ログイン UI + Node 単体テスト 38 件、ローカル ORIGIN を 5273 に修正（#14。skill の UNVERIFIED 3 件を実物で解消、rate limiter は現行版ならローカル実動 = 書き戻しメモは PR 本文）
- 2026-08-24 Workers Builds の deploy command が本番マイグレを当てることを実証（#11 merge 直後、ホストの `wrangler d1 migrations list --remote` = 未適用 0 件）。以後マイグレを含む PR は merge するだけでよい（#12、dev-environment.md §3 に恒久記録）
- 2026-08-24 縦切り PR1 merge: 6 テーブル（user/credential/session/post/tag/post_tags）の実スキーマ + Drizzle 配線（ルート無し）、additive 検査 migrations.test.ts を CI に。0000_init との連番衝突は 0001 へずらして解決（#11、skill cloudflare-d1-drizzle-migration）
- 2026-08-23 push 起動の Workers Builds を実証（`main` の #7 / #8 / #9 の各 commit に check-run `Workers Builds: kokemusu` が success）。Phase 0 の残件が消えた
- 2026-08-23 対話シェルを `op run` で包むのをやめ（TTY が壊れる）、`shell.sh` に TTY 判定と `op://` パーサの堅牢化、`.claude/settings.json` の deny の穴（refspec 形の push / ブランチ削除）を塞ぐ（#8 / #9）
- 2026-08-23 最初の縦切り「投稿 → タグ → ヒートマップに 1 マス点く」を PR1〜6 に分割（`docs/plans/vertical-slice.md`）。決めること 4（UI トーン）・6（タグ構造）・9（集計の「日」）を確定、`RP_ID = kokemusu.shiraoka.workers.dev` を永久固定、GitHub token を `./shell.sh` の exec 時シェルへ移動（#7）
- 2026-08-23 進捗管理を status hub 化: `docs/status.md`（40 行上限）+ `docs/log.md` + SessionStart hook + `/handoff` + CI の上限検査。CLAUDE.md を規約のみに圧縮（#6）
- 2026-08-23 Workers Builds 接続完了。本番 `/health` 200・SPA 配信・`0000_init` 適用。My Profile で作った手作りトークンは picker に出ず「新しいトークンを作成する」で生成（skill `cloudflare-workers-builds-keyless-deploy` 0.3.0 = okayus-skills #24）。push 起動のビルドは未実証
- 2026-08-23 #3（docs drift）・#5（grill: ADR-0001 本文暗号化 / ADR-0002 受け側 PAT / `CONTEXT.md`）・#4（歩く骨格 `apps/web`、CI を typecheck/build/test 化、`database_id` 実 UUID）を merge
- 2026-08-22 サンドボックス再同期（node:24）・1 リポ限定 PAT を 1Password で注入（`./up.sh`）・MCP（cloudflare-docs / context7）・docs egress 10 ドメイン・`modern-web-guidance` 同梱・CI placeholder・`main` ruleset。E2E は #1、docs は #2
- 2026-06-05 デプロイ方式 = Cloudflare Workers + D1 に決定（roadmap「決めること」1）
