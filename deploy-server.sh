#!/bin/bash
set -e

# Default to test if no arg provided
ENV="${1:-test}"

if [ "$ENV" == "prod" ]; then
  DEST_DIR=${DEPLOY_PROD_SERVER_DIR:-"/home/mbrizic/hosting/spacerally-server"}
  PORT=8787
else
  DEST_DIR=${DEPLOY_TEST_SERVER_DIR:-"/home/mbrizic/hosting/spacerally-server/test"}
  PORT=8788
fi

HOST=${DEPLOY_HOST:-"mbrizic.com"}

# Optional TURN (coturn) deployment + env wiring.
#
# Usage (locally when running this script):
#   export DEPLOY_TURN_URLS='turn:YOUR_DOMAIN:3478?transport=udp,turn:YOUR_DOMAIN:3478?transport=tcp'
#   export DEPLOY_TURN_SHARED_SECRET='some-long-random-string'
#   export DEPLOY_ENABLE_TURN=1
#
# If DEPLOY_ENABLE_TURN=1, we will upload ./turn/* to "$DEST_DIR/turn" and try to run:
#   docker compose up -d
# Note: TURN requires firewall ports open on the server:
#   - 3478/udp and 3478/tcp
#   - relay UDP range (ufw syntax uses ':' for ranges, e.g. 49160:49260/udp)

DEPLOY_ENABLE_TURN=${DEPLOY_ENABLE_TURN:-0}
DEPLOY_TURN_URLS=${DEPLOY_TURN_URLS:-""}
DEPLOY_TURN_SHARED_SECRET=${DEPLOY_TURN_SHARED_SECRET:-""}

# Remote env loading helper.
# Note: many ~/.bashrc files `return` early for non-interactive shells, so we
# also source ~/.profile (recommended place for exports needed by automation).
REMOTE_ENV="source ~/.profile >/dev/null 2>&1 || true; source ~/.bashrc >/dev/null 2>&1 || true"

echo "🚀 Deploying SERVER to $ENV ($HOST:$DEST_DIR)..."

# Ensure we are rebuilding with fresh deps
rm -rf server/dist
mkdir -p server/dist

# Copy source files and dependencies lock
cp server/package.json server/dist/
if [ -f server/bun.lock ]; then
  cp server/bun.lock server/dist/
fi
cp -r server/src server/dist/

# Create tarball
echo "📦 Packaging..."
tar -czf server-deploy.tar.gz -C server/dist .

# Optional: package TURN config
if [ "$DEPLOY_ENABLE_TURN" == "1" ]; then
  if [ ! -f turn/docker-compose.yml ] || [ ! -f turn/turnserver.conf ]; then
    echo "❌ TURN enabled but turn/docker-compose.yml or turn/turnserver.conf missing"
    exit 1
  fi
  echo "📦 Packaging TURN config..."
  tar -czf turn-deploy.tar.gz -C turn .
fi

# Upload
echo "⬆️ Uploading..."
ssh $HOST "mkdir -p $DEST_DIR"
scp server-deploy.tar.gz $HOST:$DEST_DIR/

if [ "$DEPLOY_ENABLE_TURN" == "1" ]; then
  ssh $HOST "mkdir -p $DEST_DIR/turn"
  scp turn-deploy.tar.gz $HOST:$DEST_DIR/turn/
fi

# Extract and Install - use full path to bun
echo "🔧 Installing..."
ssh $HOST "cd $DEST_DIR && tar -xzf server-deploy.tar.gz && rm server-deploy.tar.gz && ~/.bun/bin/bun install --production" || {
  echo "❌ Installation failed on remote server"
  exit 1
}

if [ "$DEPLOY_ENABLE_TURN" == "1" ]; then
  echo "🔧 Installing TURN config..."
  ssh $HOST "cd $DEST_DIR/turn && tar -xzf turn-deploy.tar.gz && rm turn-deploy.tar.gz" || {
    echo "❌ TURN config install failed on remote server"
    exit 1
  }

  # Prefer remote env vars (TURN_SHARED_SECRET/TURN_URLS) from ~/.bashrc.
  # Local DEPLOY_TURN_* vars remain supported but are optional.
  if [ -z "$DEPLOY_TURN_SHARED_SECRET" ] || [ -z "$DEPLOY_TURN_URLS" ]; then
    echo "🔎 Checking remote TURN_* env (from ~/.profile and ~/.bashrc)..."
    ssh $HOST "bash -lc '$REMOTE_ENV; test -n \"\$TURN_SHARED_SECRET\" && test -n \"\$TURN_URLS\"'" || {
      echo "❌ TURN enabled but TURN_SHARED_SECRET/TURN_URLS are not set on the server (in ~/.profile or ~/.bashrc)."
      echo "   Fix on server (as the same user running pm2/docker):"
      echo "     echo \"export TURN_SHARED_SECRET='...long random...'\" >> ~/.profile"
      echo "     echo \"export TURN_URLS='turn:spacerally.supercollider.hr:3478?transport=udp,turn:spacerally.supercollider.hr:3478?transport=tcp'\" >> ~/.profile"
      echo "   Then: source ~/.profile"
      exit 1
    }
  fi
fi

# Restart Service (Assuming PM2 or similar)
echo "🔄 Restarting..."
# Using PM2 for process management - adjust name based on env
APP_NAME="spacerally-signal-$ENV"

# Build a stable environment for the pm2 process (TURN vars optional).
PM2_ENV_PREFIX="PORT=$PORT"

# If local TURN vars are provided, use them; otherwise rely on remote TURN_* env.
if [ -n "$DEPLOY_TURN_URLS" ]; then
  PM2_ENV_PREFIX="$PM2_ENV_PREFIX TURN_URLS='$DEPLOY_TURN_URLS'"
fi
if [ -n "$DEPLOY_TURN_SHARED_SECRET" ]; then
  PM2_ENV_PREFIX="$PM2_ENV_PREFIX TURN_SHARED_SECRET='$DEPLOY_TURN_SHARED_SECRET'"
fi

ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR && env $PM2_ENV_PREFIX /home/mbrizic/.nvm/versions/node/v22.7.0/bin/pm2 start src/index.ts --name $APP_NAME --interpreter ~/.bun/bin/bun --update-env || env $PM2_ENV_PREFIX /home/mbrizic/.nvm/versions/node/v22.7.0/bin/pm2 restart $APP_NAME --update-env'" || {
  echo "❌ Service restart failed"
  exit 1
}

if [ "$DEPLOY_ENABLE_TURN" == "1" ]; then
  echo "🔄 Restarting TURN (coturn)..."
  # Prefer running docker as the deploy user (requires docker group membership).
  # Fall back to non-interactive sudo so deploy doesn't hang waiting for a password.
  DOCKER_UP_CMD="(docker compose up -d || docker-compose up -d || sudo -n docker compose up -d || sudo -n docker-compose up -d)"
  # Prefer remote TURN_SHARED_SECRET from ~/.bashrc; fall back to local DEPLOY_TURN_SHARED_SECRET.
  if [ -n "$DEPLOY_TURN_SHARED_SECRET" ]; then
    ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR/turn && TURN_SHARED_SECRET='$DEPLOY_TURN_SHARED_SECRET' $DOCKER_UP_CMD'" || {
      echo "❌ TURN restart failed. Likely Docker permissions (or docker isn't installed)."
      echo "   If you just ran: sudo usermod -aG docker <user>"
      echo "   you must logout/login (or reconnect SSH) for group membership to apply."
      echo "   Quick check: id -nG | grep docker"
      echo "   Alternative: allow passwordless sudo for docker/docker-compose."
      exit 1
    }
  else
    ssh $HOST "bash -lc '$REMOTE_ENV; cd $DEST_DIR/turn && $DOCKER_UP_CMD'" || {
      echo "❌ TURN restart failed. Likely Docker permissions (or docker isn't installed)."
      echo "   If you just ran: sudo usermod -aG docker <user>"
      echo "   you must logout/login (or reconnect SSH) for group membership to apply."
      echo "   Quick check: id -nG | grep docker"
      echo "   Alternative: allow passwordless sudo for docker/docker-compose."
      exit 1
    }
  fi
fi

# Clean up local artifact
rm server-deploy.tar.gz
rm -rf server/dist

if [ "$DEPLOY_ENABLE_TURN" == "1" ]; then
  rm turn-deploy.tar.gz
fi

echo "✅ Server deployment complete!"
