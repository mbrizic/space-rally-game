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

echo "🚀 Deploying SERVER to $ENV ($HOST:$DEST_DIR)..."

# Ensure we are rebuilding with fresh deps
rm -rf server/dist
mkdir -p server/dist

# Copy source files
cp server/package.json server/dist/
cp -r server/src server/dist/

# Create tarball
echo "📦 Packaging..."
tar -czf server-deploy.tar.gz -C server/dist .

# Upload
echo "⬆️ Uploading..."
ssh $HOST "mkdir -p $DEST_DIR"
scp server-deploy.tar.gz $HOST:$DEST_DIR/

# Helper to source environment variables
INIT_CMD="source ~/.bash_profile 2>/dev/null || source ~/.bashrc 2>/dev/null || source ~/.profile 2>/dev/null"

# Extract and Install
echo "🔧 Installing..."
ssh $HOST "$INIT_CMD && cd $DEST_DIR && tar -xzf server-deploy.tar.gz && rm server-deploy.tar.gz && bun install --production"

# Restart Service (Assuming PM2 or similar)
echo "🔄 Restarting..."
# Using PM2 for process management - adjust name based on env
APP_NAME="spacerally-signal-$ENV"
ssh $HOST "$INIT_CMD && cd $DEST_DIR && pm2 start src/index.ts --name $APP_NAME --interpreter bun --env PORT=$PORT --update-env || pm2 restart $APP_NAME --update-env"

# Clean up local artifact
rm server-deploy.tar.gz
rm -rf server/dist

echo "✅ Server deployment complete!"
