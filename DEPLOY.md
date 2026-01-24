# Deployment Guide

## Quick Deploy

To deploy the game to your server:

```bash
npm run deploy
```

Or run the script directly:

```bash
./deploy.sh
```

## What it does

1. Builds the production version (`npm run build`)
2. Creates a compressed tarball of the `dist` folder
3. SCPs it to `mbrizic.com:/home/mbrizic/hosting/spacerally/`
4. Extracts it on the server
5. Cleans up temporary files

## Prerequisites

- SSH access configured to `mbrizic.com` (preferably with SSH keys)
- Directory `/home/mbrizic/hosting/spacerally/` exists on the server
- Web server (nginx/apache) configured to serve from that directory

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

After deployment, the game should be available at:
- https://mbrizic.com/spacerally

## Manual Deployment

If you prefer manual deployment:

```bash
# Build
npm run build

# Copy to server
scp -r dist/* mbrizic.com:/home/mbrizic/hosting/spacerally/
```

## Troubleshooting

- **Permission denied**: Make sure you have SSH key access set up
- **Directory not found**: Create the directory on the server first: `ssh mbrizic.com "mkdir -p /home/mbrizic/hosting/spacerally"`
- **404 errors**: Check your web server configuration and ensure it's serving the correct directory
