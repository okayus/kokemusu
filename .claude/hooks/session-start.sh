#!/usr/bin/env bash
# SessionStart hook: セッション開始・再開・/clear・compact 後に「いま」を注入する。
# SessionStart の stdout はそのまま Claude のコンテキストに入る（PreCompact / Stop の stdout は捨てられる）。
# ホスト（CLAUDE_PROJECT_DIR=リポ）でもコンテナ（/workspace）でも同じに動く。失敗してもセッションは止めない。
set -u
root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root" || exit 0

if [ -f docs/status.md ]; then
  echo "=== docs/status.md（いまのハブ。終わった項目は /handoff で docs/log.md へ）==="
  cat docs/status.md
fi
if [ -f docs/log.md ]; then
  echo
  echo "=== docs/log.md（直近 5 行。全体は head -20 docs/log.md）==="
  grep -m 5 '^- ' docs/log.md
fi
echo
echo "=== git（branch / 直近 5 commit）==="
git rev-parse --abbrev-ref HEAD 2>/dev/null
git log --oneline -5 2>/dev/null
exit 0
