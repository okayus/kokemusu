#!/usr/bin/env sh
# Open a shell in the running dev sandbox WITH the repo-scoped GitHub token, resolved
# from 1Password and injected into THIS shell only (never into the container config).
#
#   ./shell.sh                      # zsh that can `git push` / `gh pr create`
#   ./shell.sh claude --continue    # or run a command directly
#
# Two things this script is careful about:
#
# 1. The token is NOT in docker-compose.yml `environment:`. There it would be part of
#    the container's config, so any `docker compose up -d` that doesn't go through
#    1Password counts as a config change: compose stops and RECREATES the container,
#    silently dropping the token and every process inside (including a running agent
#    session). Injecting at exec time keeps `./up.sh` credential-free and idempotent.
#
# 2. The interactive process is NOT wrapped in `op run`. `op run` masks secrets on the
#    stdout/stderr of its child, i.e. it interposes on those streams — an interactive
#    `docker exec -it` then loses its terminal: the prompt leaks raw escape templates
#    and the pty falls back to 80x24 (a small window in the corner of your terminal).
#    So resolve the value first with `op read`, then exec docker with the real
#    terminal still attached. The value travels in the environment, never in argv,
#    so it does not show up in `ps` on the host.
#
# Fail closed: no 1Password, no token, no push.
# Skill: sandboxed-agent-github-token-via-1password (exec-time variant, 2026-08-23).
set -eu
cd "$(dirname "$0")"
[ "$#" -gt 0 ] || set -- zsh

container=kokemusu-dev
envfile=.docker/sandbox.env

state=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo missing)
[ "$state" = "true" ] || {
  echo "shell.sh: container $container is not running (state: $state). Start it with ./up.sh" >&2
  exit 1
}

[ -f "$envfile" ] || {
  echo "shell.sh: $envfile not found (copy .docker/sandbox.env.example and point it at your vault)" >&2
  exit 1
}

# `GH_TOKEN="op://<vault>/<item>/credential"` -> the bare op:// reference
ref=$(sed -n 's/^[[:space:]]*GH_TOKEN[[:space:]]*=[[:space:]]*//p' "$envfile" | head -1 | tr -d '"'\''')
case "$ref" in
  op://*) ;;
  *) echo "shell.sh: no op:// reference for GH_TOKEN in $envfile" >&2; exit 1 ;;
esac

GH_TOKEN=$(op read "$ref") || {
  echo "shell.sh: op read failed for $ref (1Password session? item renamed?)" >&2
  exit 1
}
[ -n "$GH_TOKEN" ] || { echo "shell.sh: resolved GH_TOKEN is empty" >&2; exit 1; }
export GH_TOKEN

exec docker exec -it -e GH_TOKEN "$container" "$@"
