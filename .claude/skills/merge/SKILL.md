---
name: merge
description: PR を merge して本番反映まで見届け、ローカルを片付ける定型。持ち主が「マージして」「merge して」と PR の merge を明示的に頼んだとき、または /merge と打ったときに使う。migration を含む PR は、D1 Time Travel の bookmark が PR にコメントされていなければ merge しない。自分の判断で merge を始めるためには使わない。
effort: medium
argument-hint: "[PR番号（省略時は現在のブランチの PR）]"
---

対象: $ARGUMENTS（空なら現在のブランチの PR）。

frontmatter の `effort: medium` は、定型の merge をセッションの effort（max）で回さないため（2026-09-20。5 週間で「マージして」は 47 回、1 回あたり中央値 2.2 分・平均 8 千トークン）。この skill が動くターンだけに効く。手順に無い調査や改善はしない。気づいたことは最後の報告に 1 行で添える。

## 手順（この順で。省略しない）

1. **対象の確認**: `gh pr view <PR> --json number,title,state,mergeStateStatus,headRefName,files`。`MERGED` なら 5 へ。`CLOSED` なら報告して終わる。
2. **関門**（触っているパスで決まる。CLAUDE.md の git 規約と同じ）:
   - `apps/web/drizzle/` を含む = **migration**。`gh pr view <PR> --comments` に「D1 Time Travel bookmark」のコメントがあるかを見る。**無ければ merge しない**。次の 1 行を案内して終わる（コンテナは Cloudflare の資格情報を持たないので、ホストでしか取れない）: `node ~/.config/d1-backup/d1-bookmark.mjs kokemusu <PR>`。bookmark があれば続ける。既存行の書き換え・rebuild・DROP を含むなら、PR 本文に戻し方が書いてあることも見る。
   - `.github/**` / `.claude/**` / `docs/adr/**` を含む = 持ち主が差分を見てから merge する PR。該当ファイルの一覧を示し、AskUserQuestion で「差分を見たか」を 1 回だけ確認する。見ていなければ終わる。
   - それ以外はそのまま続ける。
3. **CI**: `gh pr checks <PR>`。red なら merge せず、失敗した job と最初のエラーを報告して終わる。pending は待ってよい。
4. **merge**: `gh pr merge --auto --squash <PR>`（`--auto` なしの即時 merge は使わない）。merge されるまで見届ける。待つときは Monitor の until ループを使う（`sleep N && …` の連結はハーネスに止められる）:
   `until [ "$(gh pr view <PR> --json state -q .state)" = MERGED ]; do sleep 10; done`
   CI が green なのに OPEN のままなら、同じ `gh pr merge --auto --squash <PR>` を打ち直す。
5. **本番反映の確認**（`docs/` と `*.md` だけの PR は Workers Builds が走らないので飛ばす）: merge commit の sha を `gh pr view <PR> --json mergeCommit -q .mergeCommit.oid` で取り、public リポなので未認証の
   `curl -s https://api.github.com/repos/okayus/kokemusu/commits/<sha>/check-runs`
   で `Workers Builds: kokemusu` が `success` になるのを待つ。そのあと `curl -s -o /dev/null -w '%{http_code}' https://kokemusu.shiraoka.workers.dev/health` が 200。migration を含んでいたら、適用は Workers Builds の deploy command が行う。事後確認の SQL は PR 本文のものを持ち主に渡す（コンテナからは本番 D1 を読めない）。
6. **片付け**: `git switch main` → `git pull --ff-only` → `git fetch --prune` → merge した head ブランチをローカルから消す（squash merge なので `git branch -d` は通らない。**いま merge を確認したそのブランチだけ**を `git branch -D` で消す）。
7. **報告**: 1〜3 行。PR 番号、merge commit、本番反映の結果、残った人手作業（secret の投入、実機での目視など）。進捗の書き戻しは `/handoff` の仕事なので、ここではしない。
