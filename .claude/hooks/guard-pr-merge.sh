#!/usr/bin/env bash
# PreToolUse(Bash): gh pr merge を次のときに止める（exit 2 = 拒否。stderr が Claude に返る）。
#  - --auto --squash 以外の形。即時 merge は required check を待たず、--admin は ruleset を迂回する
#  - apps/web/drizzle/ を含む PR に D1 Time Travel の bookmark コメントが無い（merge = 本番 D1 への適用）
# PR の中身を確かめられないときも止める。migration を素通しにしないため。
set -u
set -f

deny() {
  echo "guard-pr-merge: $1" >&2
  exit 2
}

input=$(cat)
case "$input" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac
command -v jq >/dev/null 2>&1 || deny "jq が無いので gh pr merge を検査できない"
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
case "$cmd" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac

[ "$(grep -o 'gh pr merge' <<<"$cmd" | wc -l)" -eq 1 ] || deny "gh pr merge は 1 回に 1 PR だけにする"
args=" ${cmd#*gh pr merge} "
case "$args" in *" --admin"*) deny "--admin は使わない（ruleset を迂回する）" ;; esac
case "$args" in *" --auto "*) ;; *) deny "merge は gh pr merge --auto --squash <PR番号> の形だけ（required check を待たせる）" ;; esac
case "$args" in *" --squash "*) ;; *) deny "merge は --squash で行う" ;; esac

pr=""
for tok in $args; do
  case "$tok" in
    "&&" | "||" | ";" | "|") break ;;
    -*) ;;
    */pull/[0-9]*)
      pr=${tok##*/pull/}
      pr=${pr%%[!0-9]*}
      break
      ;;
    *[!0-9]*) ;;
    *)
      pr=$tok
      break
      ;;
  esac
done
[ -n "$pr" ] || pr=$(gh pr view --json number -q .number 2>/dev/null) || true
[ -n "$pr" ] || deny "対象の PR を決められない（gh pr merge --auto --squash <PR番号> と書く）"

files=$(gh pr view "$pr" --json files -q '.files[].path' 2>/dev/null) ||
  deny "PR #$pr の変更ファイルを取得できない（gh の認証かネットワークを確かめる）"
if grep -q '^apps/web/drizzle/' <<<"$files"; then
  comments=$(gh pr view "$pr" --json comments -q '.comments[].body' 2>/dev/null) ||
    deny "PR #$pr のコメントを取得できない"
  grep -q 'D1 Time Travel bookmark' <<<"$comments" ||
    deny "PR #$pr は migration を含むのに D1 Time Travel の bookmark コメントが無い。持ち主にホストで node ~/.config/d1-backup/d1-bookmark.mjs kokemusu $pr を実行してもらう"
fi
exit 0
