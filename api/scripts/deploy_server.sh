#!/bin/sh
# Deploy the API on the droplet: the latest main, rebuilt, health-checked.
#
# GitHub Actions runs this after the tests pass on a push to main (see
# .github/workflows/ci.yml and docs/DEPLOYMENT.md). It is installed as
# /usr/local/bin/fable-deploy and is the only thing the deploy key can run:
# its authorized_keys line forces this command, so the key cannot open a shell.
#
# It can also be run by hand on the server: fable-deploy
#
# If the new version does not answer its health check, the previous one is
# rebuilt and the script fails, so a broken push never stays live.
set -eu

REPO=${FABLE_REPO:-/var/www/fable}
HEALTH=${FABLE_HEALTH_URL:-http://localhost:8010/health}

# One deploy at a time: a second push waits for the first to finish.
exec 9>/tmp/fable-deploy.lock
flock 9

cd "$REPO"
before=$(git rev-parse HEAD)
git fetch --quiet origin main
# reset, not pull: main may have been rewritten, and nothing on the server is
# edited by hand (.env and the database are ignored by git and kept).
git reset --hard --quiet origin/main
after=$(git rev-parse HEAD)
echo "Deploying $(git log -1 --format='%h %s' "$after")"

# Healthy means /health answers AND every required router loaded: the API can
# answer /health while the scoring engine failed to import (DEPLOYMENT.md, 9).
healthy() {
    i=0
    while [ "$i" -lt 30 ]; do
        if curl -fsS "$HEALTH" 2>/dev/null | grep -q '"missing_required_routers":\[\]'; then
            return 0
        fi
        i=$((i + 1))
        sleep 2
    done
    return 1
}

cd "$REPO/api"
# Back up the database first, with SQLite's own backup (the file is in WAL
# mode, so a plain copy can miss recent writes). The last 10 are kept.
if docker compose ps --status running --services 2>/dev/null | grep -qx api; then
    docker compose exec -T api python -c "import os, sqlite3, time; from core.config import DB_PATH; d = sqlite3.connect(os.path.join(os.path.dirname(DB_PATH), time.strftime('backup-deploy-%Y%m%d-%H%M%S.db'))); sqlite3.connect(DB_PATH).backup(d); d.close(); print('Database backed up.')"
    ls -1t data/backup-deploy-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f
fi
# The image runs as uid 10001 (Dockerfile). The SQLite volume must be
# writable by it; fix ownership once when this runs as root.
mkdir -p data
if [ "$(id -u)" = "0" ] && [ "$(stat -c %u data)" != "10001" ]; then
    chown -R 10001:10001 data
    echo "Gave data/ to the container's user (10001)."
fi
docker compose up -d --build --remove-orphans
if ! healthy; then
    echo "The new version failed its health check. Rolling back to $before."
    docker compose logs --tail 60 api || true
    cd "$REPO"
    git reset --hard --quiet "$before"
    cd "$REPO/api"
    docker compose up -d --build --remove-orphans
    healthy && echo "Rolled back; $(git log -1 --format='%h' "$before") is live again." || echo "The rollback is not healthy either. Check the server."
    exit 1
fi

# Keep this script current: the next deploy runs the version just pulled.
install -m 755 "$REPO/api/scripts/deploy_server.sh" "${FABLE_DEPLOY_BIN:-/usr/local/bin/fable-deploy}"
docker image prune -f >/dev/null 2>&1 || true
echo "Live: $(git log -1 --format='%h %s' "$after")"
