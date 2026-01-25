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

- **Permission denied**: Make sure you have SSH key access set up
- **Directory not found**: The script creates it, but you can also: `ssh mbrizic.com "mkdir -p /home/mbrizic/hosting/spacerally/test"`
- **404 errors**: Check your web server configuration and ensure it's serving the correct directory
