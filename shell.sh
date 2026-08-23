#!/usr/bin/env sh
# Open a shell in the running dev sandbox WITH the repo-scoped GitHub token, resolved
# from 1Password and injected into THIS shell only (never into the container config).
#
#   ./shell.sh                      # zsh that can `git push` / `gh pr create`
#   ./shell.sh claude --continue    # or run a command directly
#
# Why not `environment: { GH_TOKEN: ... }` in docker-compose.yml? Then the token is
# part of the container's config, and any `docker compose up -d` that doesn't go
# through `op run` counts as a config change: compose stops and RECREATES the
# container, silently dropping the token and every process inside (including a
# running Claude session). Injecting at exec time keeps `./up.sh` credential-free and
# idempotent. `docker exec -e GH_TOKEN` (name only, no `=value`) forwards the variable
# from this process's environment — the value never appears in argv, so it is not
# visible in `ps` on the host. Fail closed: no op, no token, no push.
#
# Skill: sandboxed-agent-github-token-via-1password (exec-time variant, 2026-08-23).
set -eu
cd "$(dirname "$0")"
[ "$#" -gt 0 ] || set -- zsh

state=$(docker inspect -f '{{.State.Running}}' kokemusu-dev 2>/dev/null || echo missing)
[ "$state" = "true" ] || {
  echo "shell.sh: container kokemusu-dev is not running (state: $state). Start it with ./up.sh" >&2
  exit 1
}

exec op run --env-file=.docker/sandbox.env -- sh -c '
  [ -n "${GH_TOKEN:-}" ] || {
    echo "shell.sh: op did not resolve GH_TOKEN — check .docker/sandbox.env and the op session" >&2
    exit 1
  }
  exec docker exec -it -e GH_TOKEN kokemusu-dev "$@"
' shell.sh "$@"
