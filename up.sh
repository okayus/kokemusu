#!/usr/bin/env sh
# Start (or recreate) the dev sandbox. No credential is involved: the GitHub token is
# injected per shell by ./shell.sh, so this is plain, idempotent `docker compose up`.
#
#   ./up.sh            # = docker compose up -d
#   ./up.sh --build    # extra args go to `docker compose up`
#
# Run from this directory without -f so docker-compose.override.yml (skills mount)
# is auto-loaded. History: until 2026-08-23 this wrapped `op run` and the token rode
# in the container env; see docs/dev-environment.md §1 for why that moved to exec time.
set -eu
cd "$(dirname "$0")"
exec docker compose up -d "$@"
