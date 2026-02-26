#!/bin/bash
set -e

SCRIPT_VERSION="docker-only-2026-02-26"

# PROD-only deployment
ENV="prod"
if [ $# -gt 0 ] && [ "${1:-}" != "prod" ]; then
  echo "This deploy script is PROD-only. Remove the arg or pass: prod" >&2
  exit 2
fi

DEST_DIR=${DEPLOY_PROD_SERVER_DIR:-"/home/mbrizic/hosting/spacerally-server"}
PORT=8787

HOST=${DEPLOY_HOST:-"mbrizic.com"}

# Docker Compose deployment (signaling + coturn).
#
# Optional overrides (otherwise rely on server env vars in ~/.profile / ~/.bashrc):
#   export DEPLOY_TURN_URLS='turn:YOUR_DOMAIN:3478?transport=udp,turn:YOUR_DOMAIN:3478?transport=tcp'
#   export DEPLOY_TURN_SHARED_SECRET='some-long-random-string'
#
# TURN requires firewall ports open on the server:
# - 3478/udp and 3478/tcp (TURN)
# - relay UDP range (ufw syntax uses ':' for ranges, e.g. 49160:49260/udp)
DEPLOY_TURN_URLS=${DEPLOY_TURN_URLS:-""}
DEPLOY_TURN_SHARED_SECRET=${DEPLOY_TURN_SHARED_SECRET:-""}

# Remote env loading helper.
# Note: many ~/.bashrc files `return` early for non-interactive shells, so we
# also source ~/.profile (recommended place for exports needed by automation).
REMOTE_ENV="source ~/.profile >/dev/null 2>&1 || true; source ~/.bashrc >/dev/null 2>&1 || true"

shell_quote() {
  local s="${1:-}"
  s=${s//\'/\'\"\'\"\'}
  printf "'%s'" "$s"
}

echo "🚀 Deploying SERVER to $ENV ($HOST:$DEST_DIR)..."
echo "ℹ️  deploy-server.sh version: $SCRIPT_VERSION"

# Ensure we are rebuilding with fresh deploy bundle
rm -rf server/dist
mkdir -p server/dist/server

# Copy only what the backend needs (and keep it under ./server for docker builds)
cp server/package.json server/Dockerfile server/.dockerignore server/dist/server/
if [ -f server/bun.lockb ]; then
  cp server/bun.lockb server/dist/server/
elif [ -f server/bun.lock ]; then
  cp server/bun.lock server/dist/server/
fi
cp -r server/src server/dist/server/

# Create tarball (preserves the ./server folder)
echo "📦 Packaging..."
# Avoid macOS xattr/resource-fork metadata in the tarball (prevents noisy warnings on Linux extraction).
COPYFILE_DISABLE=1 tar -czf server-deploy.tar.gz -C server/dist server

# Package TURN config (includes docker-compose.yml + turnserver.conf)
if [ ! -f turn/docker-compose.yml ] || [ ! -f turn/turnserver.conf ]; then
  echo "❌ Missing turn/docker-compose.yml or turn/turnserver.conf"
  exit 1
fi
echo "📦 Packaging TURN config..."
# Avoid macOS xattr/resource-fork metadata in the tarball (prevents noisy warnings on Linux extraction).
COPYFILE_DISABLE=1 tar -czf turn-deploy.tar.gz -C turn .

# Upload
echo "⬆️ Uploading..."
ssh $HOST "mkdir -p $DEST_DIR"
scp server-deploy.tar.gz $HOST:$DEST_DIR/

ssh $HOST "mkdir -p $DEST_DIR/turn"
scp turn-deploy.tar.gz $HOST:$DEST_DIR/turn/

# Extract and Install - use full path to bun
echo "🔧 Installing..."
ssh $HOST "cd $DEST_DIR && tar -xzf server-deploy.tar.gz && rm server-deploy.tar.gz" || {
  echo "❌ Install failed on remote server"
  exit 1
}

echo "🔧 Installing TURN config..."
ssh $HOST "cd $DEST_DIR/turn && tar -xzf turn-deploy.tar.gz && rm turn-deploy.tar.gz" || {
  echo "❌ TURN config install failed on remote server"
  exit 1
}

echo "🐳 Restarting signaling + TURN via Docker Compose..."

COMPOSE_PROJECT="spacerally-server"
APP_NAME="spacerally-signal-prod"

# Always pass SIGNALING_PORT so prod binds the intended port.
# Allow local DEPLOY_TURN_* overrides; otherwise rely on server configuration.
REMOTE_EXPORTS="export SIGNALING_PORT=$PORT;"
if [ -n "$DEPLOY_TURN_SHARED_SECRET" ]; then
  REMOTE_EXPORTS="$REMOTE_EXPORTS export TURN_SHARED_SECRET=$(shell_quote "$DEPLOY_TURN_SHARED_SECRET");"
fi
if [ -n "$DEPLOY_TURN_URLS" ]; then
  REMOTE_EXPORTS="$REMOTE_EXPORTS export TURN_URLS=$(shell_quote "$DEPLOY_TURN_URLS");"
fi

echo "🔄 Restarting Docker Compose stack..."

# 1) Ensure compose v2 exists (fail fast with a clear message)
ssh $HOST "bash -lc '$REMOTE_ENV; docker compose version'" || {
  echo "❌ Docker Compose v2 is required on the server (docker compose ...)."
  exit 1
}

# 2) Best-effort cleanup of legacy non-docker signaling that may still be holding the port.
ssh $HOST "bash -lc '$REMOTE_ENV; command -v pm2 >/dev/null 2>&1 && pm2 delete $APP_NAME >/dev/null 2>&1 || true'" || true

# 3) Bring down any previous run of this compose project to free the port.
ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR/turn && $REMOTE_EXPORTS docker compose -p $COMPOSE_PROJECT -f docker-compose.yml down --remove-orphans'" || true

# 4) Preflight: fail fast if the port is still in use.
ssh $HOST "bash -lc '$REMOTE_ENV; if command -v ss >/dev/null 2>&1 && ss -ltn sport = :$PORT | tail -n +2 | grep -q .; then echo \"❌ Port $PORT is already in use on the server.\"; ss -ltn sport = :$PORT || true; exit 1; fi'" || {
  echo "❌ Port $PORT is already allocated on the server. Stop whatever is using it and re-run deploy."
  exit 1
}

# 5) Start/update stack
ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR/turn && $REMOTE_EXPORTS docker compose -p $COMPOSE_PROJECT -f docker-compose.yml up -d --build --remove-orphans'" || {
  echo "❌ docker compose up failed"
  exit 1
}

# 6) Verify (keep output quiet; fail if signaling isn't running)
ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR/turn && $REMOTE_EXPORTS \
  RUNNING_SERVICES=\$(docker compose -p $COMPOSE_PROJECT -f docker-compose.yml ps --services --status running 2>/dev/null || true); \
  echo \"\$RUNNING_SERVICES\" | grep -qx \"signaling\"'" || {
  echo "❌ signaling is not running. On the server, run:"
  echo "   cd $DEST_DIR/turn && docker compose -p $COMPOSE_PROJECT ps && docker compose -p $COMPOSE_PROJECT logs --tail 200"
  exit 1
}

# Clean up local artifact
rm server-deploy.tar.gz
rm -rf server/dist
rm turn-deploy.tar.gz

echo "✅ Server deployment complete!"
