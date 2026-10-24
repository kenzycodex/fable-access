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
BIN=${FABLE_DEPLOY_BIN:-/usr/local/bin/fable-deploy}
# The API image runs as this user (api/Dockerfile).
APP_UID=10001

# One deploy at a time: a second push waits for the first to finish.
exec 9>/tmp/fable-deploy.lock
flock 9

cd "$REPO"
before=$(git rev-parse HEAD)
git fetch --quiet origin main

# Always deploy with the deploy script of the commit being deployed. The
# installed copy used to be refreshed only after a successful deploy, so a push
# that changed this script was first deployed by the previous version of it
# (that is how the first Phase 0 deploy started a non-root image without
# fixing the data folder's ownership). If the script in origin/main differs
# from the installed one, install it and run it instead, once.
if [ -z "${FABLE_DEPLOY_REEXEC:-}" ]; then
    next=$(mktemp /tmp/fable-deploy.XXXXXX)
    git show origin/main:api/scripts/deploy_server.sh > "$next"
    if ! cmp -s "$next" "$BIN" 2>/dev/null; then
        if install -m 755 "$next" "$BIN" 2>/dev/null; then
            echo "The deploy script changed in this push: installed it and running the new version."
            rm -f "$next"
            FABLE_DEPLOY_REEXEC=1 exec "$BIN"
        fi
        echo "The deploy script changed in this push: running the new version (could not install it to $BIN)."
        FABLE_DEPLOY_REEXEC=1 exec sh "$next"
    fi
    rm -f "$next"
fi
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
# The image runs as uid 10001 (Dockerfile), so data/ and every file in it
# (fable.db, its -wal and -shm files, backups) must belong to 10001:10001.
# Checked here, after the backup (a backup taken by an older, root container is
# owned by root) and before the running container is replaced. Fixed when this
# runs as root; otherwise the deploy stops with nothing switched.
data_owned() {
    [ -z "$(find data \( ! -uid "$APP_UID" -o ! -gid "$APP_UID" \) -print 2>/dev/null | head -1)" ]
}
mkdir -p data
if ! data_owned; then
    if [ "$(id -u)" = "0" ]; then
        chown -R "$APP_UID:$APP_UID" data
        echo "Gave data/ and every file in it to the container's user ($APP_UID:$APP_UID)."
    fi
    if ! data_owned; then
        echo "Stopping before switching containers: these are not owned by $APP_UID:$APP_UID, so the new API could not write its database:"
        find data \( ! -uid "$APP_UID" -o ! -gid "$APP_UID" \) -exec ls -lnd {} + 2>/dev/null | head -20
        echo "Run as root on this server: chown -R $APP_UID:$APP_UID $REPO/api/data, then deploy again."
        echo "The running version was not touched."
        cd "$REPO"
        git reset --hard --quiet "$before"
        exit 1
    fi
fi
docker compose up -d --build --remove-orphans
if ! healthy; then
    # The previous image may run as root or as 10001; either can write a data
    # folder owned by 10001, so the rollback needs no ownership change.
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
