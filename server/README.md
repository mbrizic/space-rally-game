# Server Infra (Signaling)

Low-latency co-op should run **P2P via WebRTC DataChannels**. This backend is only the **signaling** service (offer/answer + ICE candidate exchange).

## Why a Server Exists At All

- WebRTC needs an out-of-band channel to exchange connection info.
- Most pairs connect directly with **STUN**.
- Some networks require **TURN** (relay); TURN is a separate service (usually `coturn`).

## Run (Bun)

```bash
cd server
bun install
bun run dev
```

Env vars:
- `HOST` (default `127.0.0.1`)
- `PORT` (default `8787`)
- `ROOM_TTL_MS` (default `900000` = 15 min)

## API

HTTP:
- `GET /health` → `ok`

Optional (TURN support):
- `GET /api/turn?peer=<PEER_ID>` → `{ ok: true, iceServers: [...] }`
  - Enabled only when env vars are set (see below)

WebSocket:
- `GET /ws?room=<ROOM>&peer=<PEER_ID>`

Messages are JSON. The server relays them to other peers in the same room.

Common message shapes:
- `{"type":"offer","to":"peerB","sdp":{...}}`
- `{"type":"answer","to":"peerA","sdp":{...}}`
- `{"type":"ice","to":"peerB","candidate":{...}}`
- `{"type":"ping","t":123}`

Signaling keepalive / RTT:
- Client → server: `{"type":"ping","t":123}`
- Server → client: `{"type":"pong","echo":123,"t":1700000000000}`

The server does not interpret most message types beyond basic routing. This means client-side control messages (e.g. `restart-ice`) can be added without changing the server, as long as they include `to`.

Server adds:
- `from` (sender peer id)
- `room` (room code)

Server events:
- `{"type":"peer-joined","peer":"peerX"}`
- `{"type":"peer-left","peer":"peerX"}`

## TURN (coturn) integration

Some peers cannot connect P2P due to strict NAT/corporate/cellular constraints.

This server can mint **ephemeral TURN credentials** (TURN REST API pattern) for a coturn instance configured with `static-auth-secret`.

Env vars:
- `TURN_URLS` (comma-separated), e.g.
  - `turn:spacerally.supercollider.hr:3478?transport=udp,turn:spacerally.supercollider.hr:3478?transport=tcp`
- `TURN_SHARED_SECRET` (must match coturn’s `static-auth-secret`)

## Nginx (/api proxy)

If you expose this behind `/api/`, prefer stripping the prefix:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:8787/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /api/ws {
  proxy_pass http://127.0.0.1:8787/ws;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

