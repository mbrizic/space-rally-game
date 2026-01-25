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

WebSocket:
- `GET /ws?room=<ROOM>&peer=<PEER_ID>`

Messages are JSON. The server relays them to other peers in the same room.

Common message shapes:
- `{"type":"offer","to":"peerB","sdp":{...}}`
- `{"type":"answer","to":"peerA","sdp":{...}}`
- `{"type":"ice","to":"peerB","candidate":{...}}`
- `{"type":"ping","t":123}`

Server adds:
- `from` (sender peer id)
- `room` (room code)

Server events:
- `{"type":"peer-joined","peer":"peerX"}`
- `{"type":"peer-left","peer":"peerX"}`

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

