#!/bin/bash

# Deployment script for Space Rally
# Defaults to TEST deployments; use prod only when explicitly requested.

set -euo pipefail

DEPLOY_ENV="${1:-${DEPLOY_ENV:-test}}"

DEPLOY_HOST="${DEPLOY_HOST:-mbrizic.com}"
DEPLOY_PROD_DIR="${DEPLOY_PROD_DIR:-/home/mbrizic/hosting/spacerally}"
DEPLOY_TEST_DIR="${DEPLOY_TEST_DIR:-/home/mbrizic/hosting/spacerally/test}"

case "$DEPLOY_ENV" in
  test) DEPLOY_DIR="$DEPLOY_TEST_DIR" ;;
  prod) DEPLOY_DIR="$DEPLOY_PROD_DIR" ;;
  *)
    echo "Unknown deploy env: $DEPLOY_ENV (expected: test|prod)" >&2
    exit 2
    ;;
esac

echo "🏗️  Building project..."
npm run build

echo "📦 Creating deployment package..."
cd dist
# Avoid macOS xattr/resource-fork metadata in the tarball (prevents noisy warnings on Linux extraction).
COPYFILE_DISABLE=1 tar -czf ../deploy.tar.gz .
cd ..

echo "🚀 Deploying ($DEPLOY_ENV) to $DEPLOY_HOST:$DEPLOY_DIR ..."
ssh "$DEPLOY_HOST" "mkdir -p \"$DEPLOY_DIR\""
scp deploy.tar.gz "$DEPLOY_HOST:$DEPLOY_DIR/"

echo "📂 Extracting on server..."
ssh "$DEPLOY_HOST" "cd \"$DEPLOY_DIR\" && tar -xzf deploy.tar.gz && rm deploy.tar.gz"

echo "🧹 Cleaning up local package..."
rm deploy.tar.gz

echo "✅ Deployment complete!"
if [ "$DEPLOY_ENV" = "prod" ]; then
  echo "🌐 Your game should now be live at: https://spacerally.hexagonflux.hr/"
else
  echo "🌐 Test deploy complete (verify your server maps /test to $DEPLOY_DIR)"
fi
