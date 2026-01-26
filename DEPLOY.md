# Deployment Guide

## Quick Deploy

By default, deploys go to the **test** environment (recommended).

```bash
npm run deploy
```

Explicit test deploy:

```bash
npm run deploy:test
```

Production deploy (only when you ask for it):

```bash
npm run deploy:prod
```

Or run the script directly:

```bash
./deploy.sh test
```

## What it does

1. Builds the production version (`npm run build`)
2. Creates a compressed tarball of the `dist` folder
3. SCPs it to your server (test or prod directory)
4. Extracts it on the server
5. Cleans up temporary files

## Prerequisites

- SSH access configured (preferably with SSH keys)
- Directories exist (script will `mkdir -p`):
  - Test: `/home/mbrizic/hosting/spacerally/test`
  - Prod: `/home/mbrizic/hosting/spacerally`
- Web server (nginx/apache) configured to serve from that directory

## Config

These are overridable via env vars:

- `DEPLOY_HOST` (default: `mbrizic.com`)
- `DEPLOY_TEST_DIR` (default: `/home/mbrizic/hosting/spacerally/test`)
- `DEPLOY_PROD_DIR` (default: `/home/mbrizic/hosting/spacerally`)

## Subfolder Hosting

The build uses relative asset paths (`base: "./"` in `vite.config.ts`) so it can be served from subfolders like `/test/`.

## Server Configuration Example (nginx)

```nginx
server {
    listen 80;
    server_name mbrizic.com;
    
    location /spacerally {
        alias /home/mbrizic/hosting/spacerally;
        index index.html;
        try_files $uri $uri/ /spacerally/index.html;
    }
}
```

## Access

After prod deployment, the game should be available at:
- https://mbrizic.com/spacerally

For test deployments, map `/spacerally/test` (or your preferred URL) to `DEPLOY_TEST_DIR`.

## Manual Deployment

If you prefer manual deployment:

```bash
# Build
npm run build

# Copy to server
scp -r dist/* mbrizic.com:/home/mbrizic/hosting/spacerally/test/
```

## Troubleshooting

- **404 errors**: Check your web server configuration and ensure it's serving the correct directory

## Server (Backend) Deployment

Authentication / Signaling server is a Bun app.

### Deployment Script

```bash
# Deploy to test (port 8788)
./deploy-server.sh test

# Deploy to prod (port 8787)
./deploy-server.sh prod
```

See `MULTIPLAYER.md` for the full multiplayer + TURN setup.

### Prerequisites on Server

1. **Bun** installed (`curl -fsSL https://bun.sh/install | bash`)
2. **PM2** installed (`npm install -g pm2`) for process management
3. **Nginx** reverse proxy setup (optional but recommended for SSL)

### TURN (coturn) Relay (Optional, Recommended)

TURN is only used when peers cannot establish a direct P2P connection.

#### What you need

- Signaling server env vars:
    - `TURN_URLS` (comma-separated)
    - `TURN_SHARED_SECRET` (must match coturn’s `static-auth-secret`)
- Coturn running on the server (Docker) using the config in `turn/`.

Recommended: put TURN exports in `~/.profile` (same user that runs pm2/docker) so non-interactive deploys can read them.

Example:

```bash
echo "export TURN_SHARED_SECRET='...long random...'" >> ~/.profile
echo "export TURN_URLS='turn:spacerally.supercollider.hr:3478?transport=udp,turn:spacerally.supercollider.hr:3478?transport=tcp'" >> ~/.profile
source ~/.profile
```

#### Deploy with TURN enabled

From your local machine:

```bash
DEPLOY_ENABLE_TURN=1 ./deploy-server.sh prod
```

If Docker permissions are a problem, ensure the deploy user is in the `docker` group (then re-login):

```bash
sudo usermod -aG docker mbrizic
# logout/login or reconnect SSH
```

#### Firewall

Open these ports on the server (and in your cloud/provider firewall if applicable):

- `3478/udp`
- `3478/tcp`
- relay UDP range (see `turn/turnserver.conf`), e.g.:

```bash
sudo ufw allow 49160:49260/udp
```

### Nginx Config for WebSocket (WSS)

```nginx
location /api/ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
}
```
