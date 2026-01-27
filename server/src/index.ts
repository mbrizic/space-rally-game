type WsData = {
  room: string;
  peer: string;
  create: boolean;
};

type RelayMessage = {
  type: string;
  to?: string;
  [k: string]: unknown;
};

type Client = {
  peer: string;
  ws: ServerWebSocket<WsData>;
  lastSeenMs: number;
};

import { createHmac } from "node:crypto";

type TurnConfig = {
  urls: string[];
  username: string;
  credential: string;
};

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const ROOM_TTL_MS = Number.parseInt(process.env.ROOM_TTL_MS ?? `${15 * 60_000}`, 10);

if (!Number.isFinite(PORT)) throw new Error("Invalid PORT");
if (!Number.isFinite(ROOM_TTL_MS)) throw new Error("Invalid ROOM_TTL_MS");

const rooms = new Map<string, Map<string, Client>>();

function roomExists(room: string): boolean {
  const peers = rooms.get(room);
  return !!peers && peers.size > 0;
}

const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

const jsonHeaders: Record<string, string> = {
  ...corsHeaders,
  "content-type": "application/json; charset=utf-8",
  // Avoid caching ephemeral creds.
  "cache-control": "no-store"
};

function parseTurnUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeTurnConfig(opts: { urls: string[]; secret: string; peer: string }): TurnConfig {
  // TURN REST API: username is an expiry timestamp (seconds since epoch) + optional user id.
  // Credential is base64(hmac-sha1(secret, username)).
  const expirySeconds = Math.floor(Date.now() / 1000) + 6 * 60 * 60; // 6 hours
  const username = `${expirySeconds}:${opts.peer}`;
  const credential = createHmac("sha1", opts.secret).update(username).digest("base64");
  return { urls: opts.urls, username, credential };
}

function nowMs(): number {
  return Date.now();
}

function normalizeRoom(s: string): string {
  return s.trim().toUpperCase().slice(0, 12);
}

function normalizePeer(s: string): string {
  return s.trim().slice(0, 64);
}

function sendJson(ws: ServerWebSocket<WsData>, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function broadcast(room: string, msg: unknown, exceptPeer?: string): void {
  const peers = rooms.get(room);
  if (!peers) return;
  for (const [peer, client] of peers) {
    if (exceptPeer && peer === exceptPeer) continue;
    sendJson(client.ws, msg);
  }
}

function removePeer(room: string, peer: string): void {
  const peers = rooms.get(room);
  if (!peers) return;
  peers.delete(peer);
  if (peers.size === 0) rooms.delete(room);
}

function pruneRooms(): void {
  const t = nowMs();
  for (const [room, peers] of rooms) {
    for (const [peer, client] of peers) {
      if (t - client.lastSeenMs > ROOM_TTL_MS) {
        try {
          client.ws.close(4000, "stale");
        } catch {
          // ignore
        }
        peers.delete(peer);
      }
    }
    if (peers.size === 0) rooms.delete(room);
  }
}

setInterval(pruneRooms, 30_000).unref?.();

const server = Bun.serve<WsData>({
  hostname: HOST,
  port: PORT,
  fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (path === "/health" || path === "/api/health") {
      return new Response("ok\n", { headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" } });
    }

    // Optional TURN (coturn) support for strict NATs.
    // Configure via env:
    // - TURN_URLS="turn:your-domain:3478?transport=udp,turn:your-domain:3478?transport=tcp"
    // - TURN_SHARED_SECRET="..." (must match coturn `static-auth-secret`)
    if (path === "/turn" || path === "/api/turn") {
      const urls = parseTurnUrls(process.env.TURN_URLS);
      const secret = process.env.TURN_SHARED_SECRET ?? "";
      const peer = normalizePeer(url.searchParams.get("peer") ?? "");
      if (!urls.length || !secret || !peer) {
        return new Response(JSON.stringify({ ok: false }), { status: 404, headers: jsonHeaders });
      }

      try {
        const cfg = makeTurnConfig({ urls, secret, peer });
        return new Response(JSON.stringify({ ok: true, iceServers: [{ urls: cfg.urls, username: cfg.username, credential: cfg.credential }] }), { headers: jsonHeaders });
      } catch {
        return new Response(JSON.stringify({ ok: false }), { status: 500, headers: jsonHeaders });
      }
    }

    const isWsPath = path === "/ws" || path === "/api/ws";
    if (isWsPath) {
      const room = normalizeRoom(url.searchParams.get("room") ?? "");
      const peer = normalizePeer(url.searchParams.get("peer") ?? "");
      const create = url.searchParams.get("create") === "1";
      if (!room || !peer) return new Response("missing room/peer\n", { status: 400 });

      const ok = srv.upgrade(req, { data: { room, peer, create } });
      return ok ? undefined : new Response("upgrade failed\n", { status: 400 });
    }

    return new Response("not found\n", { status: 404, headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" } });
  },
  websocket: {
    open(ws) {
      const { room, peer, create } = ws.data;
      const t = nowMs();

      // Enforce explicit room creation so joiners can get a deterministic "room not found" error.
      if (!create && !roomExists(room)) {
        sendJson(ws, { type: "error", code: "ROOM_NOT_FOUND", room, t });
        try {
          ws.close(4004, "room not found");
        } catch {
          // ignore
        }
        return;
      }

      // Hosts should fail fast if the code is already taken.
      if (create && roomExists(room)) {
        sendJson(ws, { type: "error", code: "ROOM_TAKEN", room, t });
        try {
          ws.close(4005, "room taken");
        } catch {
          // ignore
        }
        return;
      }

      let peers = rooms.get(room);
      if (!peers) {
        peers = new Map();
        rooms.set(room, peers);
      }

      // Kick previous connection for same peer id.
      const prev = peers.get(peer);
      if (prev && prev.ws !== ws) {
        try {
          prev.ws.close(4001, "replaced");
        } catch {
          // ignore
        }
      }

      peers.set(peer, { peer, ws, lastSeenMs: t });

      // Let the joiner know who is already here.
      const existingPeers = Array.from(peers.keys()).filter((p) => p !== peer);
      sendJson(ws, { type: "welcome", room, peer, peers: existingPeers, t });

      // Notify others.
      broadcast(room, { type: "peer-joined", room, peer, t }, peer);
    },
    message(ws, message) {
      const { room, peer } = ws.data;
      const peers = rooms.get(room);
      if (!peers) return;

      const client = peers.get(peer);
      if (client) client.lastSeenMs = nowMs();

      if (typeof message !== "string") return;
      if (message.length > 256_000) {
        ws.close(1009, "message too large");
        return;
      }

      let parsed: RelayMessage;
      try {
        parsed = JSON.parse(message) as RelayMessage;
      } catch {
        return;
      }

      if (!parsed || typeof parsed.type !== "string" || parsed.type.length > 64) return;

      const out = { ...parsed, from: peer, room, t: nowMs() };

      if (typeof parsed.to === "string" && parsed.to.length > 0) {
        const toPeer = parsed.to;
        const target = peers.get(toPeer);
        if (!target) {
          sendJson(ws, { type: "error", code: "NO_SUCH_PEER", to: toPeer });
          return;
        }
        sendJson(target.ws, out);
        return;
      }

      // Broadcast to room (excluding sender).
      broadcast(room, out, peer);
    },
    close(ws) {
      const { room, peer } = ws.data;
      removePeer(room, peer);
      broadcast(room, { type: "peer-left", room, peer, t: nowMs() });
    }
  }
});

console.log(`signaling listening on http://${server.hostname}:${server.port}`);
