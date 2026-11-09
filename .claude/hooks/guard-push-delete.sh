#!/usr/bin/env bash
# PreToolUse(Bash): リモートのブランチを消す git push を止める（exit 2 = 拒否。stderr が Claude に返る）。
#  - refspec の削除形（":<branch>" と "+:<branch>"）
#  - --delete と -d（位置を問わない。"-ud" のような束ねも）、--prune、--mirror。git が受け付ける略記（"--del" など）も
# deny ルールでは書けない。末尾の ":*" は旧来の前方一致の書式として読まれ、settings.json の
# "git push * --delete *" は "git push --delete origin x" と "git push -d origin x" に当たらない。
# 見るのは命令の位置にある git の push だけ。heredoc の本文（commit メッセージなど）と、他の命令の引数の中の語は見ない。
set -u
set -f

deny() {
  echo "guard-push-delete: $1" >&2
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
  *git*push*) ;;
  *) exit 0 ;;
esac
command -v jq >/dev/null 2>&1 || deny "jq が無いので git push を検査できない"
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
cmd=$(strip_heredocs "$cmd")
# 引用符は語の区切りにし、区切り記号・括弧・改行は文の切れ目にする（"x;" のように語に付いたものも）
cmd=${cmd//[\"\']/ }
cmd=${cmd//[;&|()\`\{\}]/ ; }
cmd=${cmd//$'\n'/ ; }

state=""
at_cmd=1 # 次の語が命令の位置にあるか
for tok in $cmd; do
  if [ "$tok" = ";" ]; then
    state=""
    at_cmd=1
    continue
  fi
  case "$state" in
    push)
      case "$tok" in
        :* | +:*) deny "リモートブランチの削除（$tok）は使わない" ;;
        --de* | --mi* | --pru*) deny "リモートブランチを消す push（$tok）は使わない" ;;
        -o*) ;; # --push-option の短い形。値に d が入りうる
        -d* | -[!-]*d*) deny "リモートブランチの削除（$tok）は使わない" ;;
      esac
      continue
      ;;
    gitopt)
      state=git
      continue
      ;;
    git)
      case "$tok" in
        -C | -c | --git-dir | --work-tree | --namespace | --config-env) state=gitopt ;;
        -*) ;;
        push) state=push ;;
        *) state="" ;;
      esac
      continue
      ;;
  esac
  [ "$at_cmd" -eq 1 ] || continue
  case "$tok" in
    # 命令の前に置ける語（代入・前置きの命令・その引数）。次の語もまだ命令の位置にある
    *=* | -* | [0-9]* | sudo | env | command | builtin | exec | nohup | time | timeout | nice | stdbuf | xargs | bash | sh | zsh | then | do | else | if | while | until | '!') continue ;;
  esac
  at_cmd=0
  [ "${tok##*/}" = git ] && state=git
done
exit 0
