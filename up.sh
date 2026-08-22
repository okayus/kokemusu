#!/usr/bin/env sh
# Start the dev sandbox WITH the repo-scoped GitHub token resolved from 1Password.
#
#   ./up.sh            # = op run --env-file=.docker/sandbox.env -- docker compose up -d
#   ./up.sh --build    # extra args go to `docker compose up`
#
# Any other way of starting the container (plain `docker compose up -d`) yields a
# container WITHOUT a token — by design: compose drops an unresolved `GH_TOKEN:` key,
# so the agent can commit but not push (fail closed). Run from this directory without
# -f so docker-compose.override.yml (skills mount) is auto-loaded. ADR-0003 (2026-08-22).
set -eu
cd "$(dirname "$0")"
exec op run --env-file=.docker/sandbox.env -- docker compose up -d "$@"
