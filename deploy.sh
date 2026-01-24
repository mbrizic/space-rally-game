#!/bin/bash

# Simple deployment script for Space Rally
# Builds the project and deploys to mbrizic.com

set -e  # Exit on any error

echo "🏗️  Building project..."
npm run build

echo "📦 Creating deployment package..."
cd dist
tar -czf ../deploy.tar.gz .
cd ..

echo "🚀 Deploying to mbrizic.com..."
scp deploy.tar.gz mbrizic.com:/home/mbrizic/hosting/spacerally/

echo "📂 Extracting on server..."
ssh mbrizic.com "cd /home/mbrizic/hosting/spacerally && tar -xzf deploy.tar.gz && rm deploy.tar.gz"

echo "🧹 Cleaning up local package..."
rm deploy.tar.gz

echo "✅ Deployment complete!"
echo "🌐 Your game should now be live at: https://mbrizic.com/spacerally"
