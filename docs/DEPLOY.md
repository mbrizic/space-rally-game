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

The public production game is https://spacerally.hexagonflux.hr/.
The SSH deployment host (`mbrizic.com`) is not necessarily the public web hostname.

For test deployments, map `/test/` (or your preferred URL) to `DEPLOY_TEST_DIR`
and verify that route after uploading. With that mapping, the test URL is
https://spacerally.hexagonflux.hr/test/.

Domain changes also require updating the frontend score origin, Vite dev proxy,
backend play link, and the signaling server's `TURN_URLS`. Updating Nginx alone
does not migrate those references. Redeploy the changed frontend/backend code
and recreate signaling with the new TURN URLs; keep the existing shared secret.

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
- **Hostname does not resolve**: SSH upload success does not verify public access. Confirm the public hostname's DNS and its `/test/` web-server mapping before declaring the deployment playable.
- **Start menu buttons do nothing**: Verify that the JavaScript bundle finishes downloading, not just that it returns HTTP 200. If cached CDN responses stall but cache-busted/direct-origin requests complete, purge the affected asset from the CDN cache or publish a new fingerprinted build. Verify repeat cache-hit downloads and both singleplayer modes afterward.

## Server (Backend) Deployment

The backend is a Bun/SQLite app. The deployment script runs it together with
coturn using Docker Compose. Unlike the frontend script, it is **production-only**.

### Deployment Script

```bash
# Only when a production backend deployment is explicitly requested (port 8787)
./deploy-server.sh prod
```

`./deploy-server.sh test` is rejected. `npm run deploy-server` also targets
production. The script uploads the backend and TURN configuration, removes the
legacy PM2 process if present, and restarts both services with Docker Compose.
It does not deploy the frontend. The frontend's test deployment does not provide
an isolated test backend.

See [backend setup](../server/README.md) and [multiplayer architecture](MULTIPLAYER.md).

### Prerequisites on Server

1. **Docker Engine and Compose v2**, usable by the deployment SSH user.
2. **Nginx** reverse proxy for HTTPS and WebSocket traffic to port 8787.
3. Persistent scores use the Compose `signaling-data` volume; see
    [backup instructions](../server/API.md) before backend maintenance.

### TURN (coturn) Relay (Optional, Recommended)

TURN is only used when peers cannot establish a direct P2P connection. The
backend deployment starts the coturn container alongside signaling.

#### What you need

- Signaling server env vars:
    - `TURN_URLS` (comma-separated)
    - `TURN_SHARED_SECRET` (must match coturn’s `static-auth-secret`)
- Coturn running on the server (Docker) using the config in `turn/`.

Recommended: configure TURN exports in the remote `~/.profile` (same user that
runs Docker) so non-interactive deploys can read them. Keep real secrets out of
commits, terminal output, and chat.

Local overrides are `DEPLOY_TURN_URLS` and `DEPLOY_TURN_SHARED_SECRET`; otherwise
the script uses the remote environment. `DEPLOY_ENABLE_TURN` is not used by the
current script.

For the current domain, set remote `TURN_URLS` to
`turn:spacerally.hexagonflux.hr:3478?transport=udp,turn:spacerally.hexagonflux.hr:3478?transport=tcp`.
Changing a profile export alone does not update an already-running container.

#### Deploy with TURN enabled

From your local machine:

```bash
# After TURN credentials are configured on the server; production only
./deploy-server.sh prod
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
    proxy_pass http://127.0.0.1:8787/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
}
```
