# いま（status hub）

<!-- 上限 40 行 / 3 KB。見出し 4 つは固定。終わった項目は消して docs/log.md の先頭へ（取り消し線は禁止）。
     8 行を超える節は docs/plans/<topic>.md に切り出す。更新は /handoff。
     セッション開始時に .claude/hooks/session-start.sh がこのファイルを注入する。 -->

## フェーズ

**Phase 0 完了（2026-08-23）→ Phase 1 MVP の着手前。** 本番 `https://kokemusu.shiraoka.workers.dev` は歩く骨格（`/health` + SPA + 空 D1）でロジック = ゼロ。

## 次の 3 手

1. **push → Workers Builds 自動ビルドの実証**: この status hub の PR を merge し、`main` HEAD の check-run に `Workers Builds: kokemusu` が付くことを確認（初回は dash からの手動ビルドで check-run が無い。`gh pr checks` か `curl -s https://api.github.com/repos/okayus/kokemusu/commits/<sha>/check-runs`）。
2. **最初の縦切り**「投稿 → タグ → ヒートマップに 1 マス点く」の計画を `docs/plans/vertical-slice.md` に書く（`/grill-with-docs` で `docs/data-model.md` と突き合わせ。実スキーマ投入前に skill `cloudflare-d1-drizzle-migration` 必読。本文暗号化は最初の実データより前 = ADR-0001）。
3. 決めること 4（UI トーン）・6（タグ構造）は縦切りで必要になった時点で決める（[roadmap.md](roadmap.md)）。

## 詰まり・人手待ち

- なし。

## 進行中 PR

- なし。
