#!/usr/bin/env bash
# PreToolUse(Bash): gh pr merge を次のときに止める（exit 2 = 拒否。stderr が Claude に返る）。
#  - gh pr merge --auto --squash <PR番号> 以外の形。--auto なしは required check を待たず、--admin は ruleset を迂回する。
#    ただし PR が clean（required check が通り merge できる）なら --auto なしの --squash も通す。コンテナの gh 2.23 は
#    clean な PR への --auto を "Pull request is in clean status" で弾くので、その逃げ道（matatabetai log 2026-09-05）
#  - apps/web/drizzle/ を含む PR に、24 時間以内の D1 Time Travel bookmark のコメントが無い（merge = 本番 D1 への適用）
# PR の中身を確かめられないときも止める。migration を素通しにしないため。
# 見るのは命令の位置にある gh pr merge だけ。heredoc の本文（commit メッセージなど）と、他の命令の引数の中の語は見ない。
set -u
set -f

repo=okayus/kokemusu

deny() {
  echo "guard-pr-merge: $1" >&2
  exit 2
}

# heredoc の本文はデータなので落とす（<<< は here-string なので対象外）
strip_heredocs() {
  local line delim="" tab=$'\t'
  local re='(^|[^<])<<-?[[:space:]]*["'"'"']?([A-Za-z_][A-Za-z0-9_]*)'
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$delim" ]; then
      [ "${line#"${line%%[!$tab]*}"}" = "$delim" ] && delim=""
      continue
    fi
    printf '%s\n' "$line"
    if [[ $line =~ $re ]]; then delim=${BASH_REMATCH[2]}; fi
  done <<<"$1"
}

input=$(cat)
case "$input" in
  *"gh pr merge"*) ;;
  *) exit 0 ;;
esac
command -v jq >/dev/null 2>&1 || deny "jq が無いので gh pr merge を検査できない"
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
cmd=$(strip_heredocs "$cmd")
# 引用符は語の区切りにし、区切り記号・括弧・改行は文の切れ目にする（"71;" のように語に付いたものも）
cmd=${cmd//[\"\']/ }
cmd=${cmd//[;&|()\`\{\}]/ ; }
cmd=${cmd//$'\n'/ ; }

merges=0
args=""
state=""
at_cmd=1 # 次の語が命令の位置にあるか
for tok in $cmd; do
  if [ "$tok" = ";" ]; then
    state=""
    at_cmd=1
    continue
  fi
  case "$state" in
    merge)
      args+=" $tok"
      continue
      ;;
    gh)
      if [ "$tok" = pr ]; then state=pr; else state=""; fi
      continue
      ;;
    pr)
      if [ "$tok" = merge ]; then
        state=merge
        merges=$((merges + 1))
      else
        state=""
      fi
      continue
      ;;
  esac
  [ "$at_cmd" -eq 1 ] || continue
  case "$tok" in
    # 命令の前に置ける語（代入・前置きの命令・その引数）。次の語もまだ命令の位置にある
    *=* | -* | [0-9]* | sudo | env | command | builtin | exec | nohup | time | timeout | nice | stdbuf | xargs | bash | sh | zsh | then | do | else | if | while | until | '!') continue ;;
  esac
  at_cmd=0
  [ "${tok##*/}" = gh ] && state=gh
done
[ "$merges" -eq 0 ] && exit 0
[ "$merges" -eq 1 ] || deny "gh pr merge は 1 回に 1 PR だけにする"

args=" $args "
case "$args" in *" --admin"*) deny "--admin は使わない（ruleset を迂回する）" ;; esac
case "$args" in *" --disable-auto "*) exit 0 ;; esac
need_clean=0
case "$args" in *" --auto "*) ;; *) need_clean=1 ;; esac
case "$args" in *" --squash "* | *" -s "*) ;; *) deny "merge は --squash で行う" ;; esac

other_repo="$repo 以外の PR は、そのリポのセッションで merge する"
pr=""
n=0
want_repo=0
for tok in $args; do
  if [ "$want_repo" -eq 1 ]; then
    want_repo=0
    [ "$tok" = "$repo" ] || deny "$other_repo"
    continue
  fi
  case "$tok" in
    -R | --repo) want_repo=1 ;;
    --repo=*) [ "${tok#--repo=}" = "$repo" ] || deny "$other_repo" ;;
    -R?*) [ "${tok#-R}" = "$repo" ] || deny "$other_repo" ;;
    https://github.com/*/pull/[0-9]*)
      slug=${tok#https://github.com/}
      [ "${slug%%/pull/*}" = "$repo" ] || deny "$other_repo"
      num=${tok##*/pull/}
      pr=${num%%[!0-9]*}
      n=$((n + 1))
      ;;
    -*) ;;
    *[!0-9]*) ;;
    *)
      pr=$tok
      n=$((n + 1))
      ;;
  esac
done
[ "$n" -eq 1 ] || deny "対象の PR を 1 つに決められない（gh pr merge --auto --squash <PR番号> と書く）"

info=$(gh pr view "$pr" -R "$repo" --json files,changedFiles,comments,mergeStateStatus 2>/dev/null) ||
  deny "PR #$pr の変更ファイルを取得できない（gh の認証かネットワークを確かめる）"
if [ "$need_clean" -eq 1 ] && [ "$(jq -r '.mergeStateStatus // ""' <<<"$info")" != CLEAN ]; then
  deny "--auto なしの merge は、CI が green で clean な PR だけ。それ以外は gh pr merge --auto --squash <PR番号> で arm する"
fi
listed=$(jq '.files | length' <<<"$info")
total=$(jq '.changedFiles' <<<"$info")
[ "$listed" -ge "$total" ] 2>/dev/null ||
  deny "PR #$pr の変更ファイルの一覧が途中で切れていて（$total 件中 $listed 件）検査できない。持ち主に merge してもらう"
if jq -e 'any(.files[]; .path | startswith("apps/web/drizzle/"))' <<<"$info" >/dev/null; then
  fresh=$(jq --argjson now "$(date +%s)" '[.comments[]
    | select((.body | test("D1 Time Travel bookmark"))
      and (.body | test("[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}"))
      and ((.createdAt | fromdateiso8601) > $now - 86400))] | length' <<<"$info")
  [ "$fresh" -gt 0 ] 2>/dev/null ||
    deny "PR #$pr は migration（apps/web/drizzle/）を含むのに、24 時間以内の D1 Time Travel bookmark のコメントが無い。merge の直前に、持ち主にホストで node ~/.config/d1-backup/d1-bookmark.mjs kokemusu $pr を実行してもらう"
fi
exit 0
