# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 2 — 縦切り「PAT（API 自動投稿の受け側）」完了（#31、本番デプロイ確認 2026-09-03）。** 縦切りの並び **§8 → PAT → §6** は残り §6。ただし本番の `PAT_PEPPER` が未設定なので発行はまだ 503（fail closed）— 使い始めはホスト作業（次の 3 手 1）。merge 前の回帰検知はコンテナ内 `pnpm e2e`（4 spec、`apps/web/e2e/README.md`。CI は spec の型検査のみ）。

## 次の 3 手

1. **PAT を使い始める（ホスト作業）**: `openssl rand -hex 32` を 1Password に控えてから `apps/web` で `pnpm exec wrangler secret put PAT_PEPPER` に貼る → 本番 UI「API トークン（PAT）」で発行 → mazuoboeru 側 `wrangler secret put KOKEMUSU_PAT` → スモーク `curl -s https://kokemusu.shiraoka.workers.dev/api/auth/me -H "Authorization: Bearer <token>"`。以後 `PAT_PEPPER` は変えない（変えると全 PAT 失効）。
2. **§6 タグ関係グラフ**: ノードタップの着地 = §8 フォーカス（`getTimeline({focus})` が受け皿として実装済み）。Phase 1 の取りこぼし（編集・ソフトデリート UI / Markdown + サニタイズ / タグ・期間絞り込み UI）と §8 後続強化（月セグメント棒・フォーカス → 投稿一覧の導線）はどこかで拾う。
3. **PAT skill の書き戻し**: `cloudflare-workers-pat-bearer-auth` の UNVERIFIED 2 件が kokemusu で検証済みに（passkey-session 変種 = `resolveSession` 抽出 + Variables `{userId, displayName, authMethod, scopes}` ／ API e2e spec 実走）。pepper fail-closed 化・PAT 到達面を絞る変種も添える。okayus-skills#41 merge 後にホストの okayus-skills を `main` に戻す（`git switch main && git pull`。コンテナの skills mount はホストの working tree）のと合わせて。

## 詰まり・人手待ち

- okayus-skills#41（e2e 0.4.0 / sandbox 0.2.0 / passkey 0.2.1 の書き戻し）の内容確認と merge。
- 本番 `PAT_PEPPER` 未設定（次の 3 手 1）。設定するまで mazuoboeru の日次投稿は始められない。

## 進行中 PR

- なし。
