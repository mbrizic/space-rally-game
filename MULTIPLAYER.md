# Multiplayer / Server Infra (WebRTC + Signaling + TURN)

This project’s multiplayer is **WebRTC DataChannel** based:

- The actual gameplay traffic is **P2P** (datachannel).
- A small backend exists only for **signaling** (offer/answer + ICE exchange).
- Some networks cannot do P2P reliably (strict NAT / corporate / cellular). For those cases we run **TURN** (`coturn`) so WebRTC can relay.

## Architecture Overview

**Client (this repo):**
- Creates or joins a room via URL params (see “Room Ownership / hostKey” below).
- Opens a WebSocket to the signaling server (`/api/ws` by default).
- Establishes a `RTCPeerConnection` with ICE servers:
  - STUN (Google)
  - optional TURN (fetched from `/api/turn`)
- Uses a single `RTCDataChannel` (“data”) for gameplay messages.

**Signaling server (Bun, `server/`):**
- Relays JSON messages between peers in a room:
  - `offer`, `answer`, `ice`, and a couple of small control messages.
- Optional endpoint `GET /api/turn?peer=...` returns **ephemeral TURN credentials** (TURN REST API pattern).

**TURN server (coturn, `turn/`):**
- Provides relay candidates when direct connection fails.
- Uses `static-auth-secret` so the signaling server can mint ephemeral creds.

## Room Ownership / `hostKey`

Room ownership is enforced client-side using a per-room `hostKey` stored in `localStorage`.

- The room creator is the host.
- Invite links are *joiner* links (they do not contain `host=1`).
- Invite links include the `hostKey` so the joiner can authenticate the session; treat it as secret.
- The in-game **DISCONNECT** button returns to solo.

## Local Development

Frontend:

```bash
npm install
npm run dev
```

Signaling server (dev):

```bash
cd server
bun install
bun run dev
```

By default, the client points signaling to same-origin `/api/ws`. For local setups you can override via URL params:

- `?signalWs=ws://localhost:8787/ws`
- or `?signal=https://your-host.example` (client will derive `/ws` and `/api/turn` from it)

## Production Deployment

There are two deploy paths:

- **Frontend (static site):** `npm run deploy` / `npm run deploy:prod` (see `DEPLOY.md`).
- **Backend (signaling + optional TURN):** `./deploy-server.sh prod`.

### Nginx routing

The production site expects `/api/*` to proxy to the signaling server.

Minimum (HTTP endpoints):

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

WebSocket upgrade (required):

```nginx
location /api/ws {
  proxy_pass http://127.0.0.1:8787/ws;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

No extra nginx config is needed for TURN itself; TURN is separate traffic.

### TURN: Required env vars

On the signaling server process:

- `TURN_URLS` (comma-separated)
  - Example:
    - `turn:spacerally.supercollider.hr:3478?transport=udp,turn:spacerally.supercollider.hr:3478?transport=tcp`
- `TURN_SHARED_SECRET` (must match coturn `static-auth-secret`)

Recommended place to define these on the server for non-interactive deploys:

- `~/.profile` (for the same user that runs PM2 + Docker)

### TURN: Ports / firewall

At minimum you need:

- `3478/udp` and `3478/tcp` (TURN listening)
- relay UDP range (configured in `turn/turnserver.conf`)
  - Example UFW syntax: `49160:49260/udp`

Also ensure your **cloud/provider firewall** allows the same ports (UFW alone may not be enough).

## Validation / Debugging

### Confirm signaling is alive

```bash
curl -sS https://spacerally.supercollider.hr/api/health
```

### Confirm TURN credentials endpoint

```bash
curl -sS 'https://spacerally.supercollider.hr/api/turn?peer=debug' | cat
```

Expected: `{ ok: true, iceServers: [...] }`.

### Confirm coturn is running

On the server:

```bash
docker ps | grep coturn
# or
sudo docker ps | grep coturn
```

Logs:

```bash
docker logs spacerally-coturn --tail 80
```

### Confirm client is using TURN when needed

In Chrome:

- open `chrome://webrtc-internals/`
- start a multiplayer session
- look at the selected candidate pair:
  - `relay` means TURN is being used
  - `srflx` / `host` means direct P2P

## “Needs refresh after connect” mitigation

If a client *connects* but the DataChannel doesn’t reliably open until refresh, it’s typically a signaling/ICE race.

Mitigations implemented in the client:

- Buffer ICE candidates until a remote description exists.
- Add a small watchdog and support ICE restart (`restart-ice` control message relayed by the signaling server).
