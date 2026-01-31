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

import { Database } from "bun:sqlite";
import { postHighScore } from "./twitter";

const db = new Database("scores.sqlite", { create: true });
db.run(
  "CREATE TABLE IF NOT EXISTS high_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, score INTEGER, seed TEXT, user_id TEXT, mode TEXT, avg_speed_kmh REAL, t INTEGER)"
);
db.run("CREATE TABLE IF NOT EXISTS track_votes (seed TEXT PRIMARY KEY, upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0)");
db.run("CREATE TABLE IF NOT EXISTS track_vote_events (user_id TEXT, seed TEXT, type TEXT, t INTEGER, PRIMARY KEY(user_id, seed))");
db.run(
  "CREATE TABLE IF NOT EXISTS game_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, seed TEXT, user_id TEXT, mode TEXT, name TEXT, score_ms INTEGER, avg_speed_kmh REAL, t INTEGER)"
);

function ensureColumn(opts: { table: string; column: string; ddl: string }): void {
  try {
    db.run(`ALTER TABLE ${opts.table} ADD COLUMN ${opts.column} ${opts.ddl}`);
  } catch {
    // ignore (already exists)
  }
}

// Best-effort migrations for existing DBs.
ensureColumn({ table: "high_scores", column: "seed", ddl: "TEXT DEFAULT '0'" });
ensureColumn({ table: "high_scores", column: "user_id", ddl: "TEXT" });
ensureColumn({ table: "high_scores", column: "mode", ddl: "TEXT" });
ensureColumn({ table: "high_scores", column: "avg_speed_kmh", ddl: "REAL" });

ensureColumn({ table: "game_stats", column: "seed", ddl: "TEXT" });
ensureColumn({ table: "game_stats", column: "user_id", ddl: "TEXT" });
ensureColumn({ table: "game_stats", column: "mode", ddl: "TEXT" });
ensureColumn({ table: "game_stats", column: "name", ddl: "TEXT" });
ensureColumn({ table: "game_stats", column: "score_ms", ddl: "INTEGER" });
ensureColumn({ table: "game_stats", column: "avg_speed_kmh", ddl: "REAL" });

// Dedupe: one score per user per seed.
db.run("CREATE UNIQUE INDEX IF NOT EXISTS high_scores_user_seed ON high_scores(user_id, seed)");



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
  "access-control-allow-methods": "GET, POST, OPTIONS",
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

function normalizeSeed(s: unknown): string {
  const raw = (s ?? "0").toString().trim();
  if (!raw) return "0";
  // Seeds are intended to be compact (0..999). Clamp numeric values into range.
  if (/^\d+$/.test(raw)) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return "0";
    return String(Math.max(0, Math.min(999, n)));
  }
  return raw.slice(0, 24);
}

function normalizeName(s: unknown): string {
  return (s ?? "anonymous").toString().trim().slice(0, 40) || "anonymous";
}

function normalizeUserId(s: unknown): string {
  return (s ?? "").toString().trim().slice(0, 80);
}

function normalizeMode(s: unknown): "timeTrial" | "practice" | null {
  const v = (s ?? "").toString().trim();
  if (v === "timeTrial" || v === "practice") return v;
  return null;
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
  async fetch(req, srv) {
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

    if (path === "/api/vote") {
      if (req.method === "GET") {
        const seed = (url.searchParams.get("seed") ?? "").trim();
        if (!seed) {
          return new Response(JSON.stringify({ error: "missing seed" }), { status: 400, headers: jsonHeaders });
        }
        const row = db.query("SELECT seed, upvotes, downvotes FROM track_votes WHERE seed = ?").get(seed) as any;
        return new Response(
          JSON.stringify({
            ok: true,
            seed,
            upvotes: typeof row?.upvotes === "number" ? row.upvotes : 0,
            downvotes: typeof row?.downvotes === "number" ? row.downvotes : 0
          }),
          { headers: jsonHeaders }
        );
      }

      if (req.method === "POST") {
        try {
          const body = (await req.json()) as { seed: string; type: "up" | "down"; userId?: string; mode?: string };
          const seed = normalizeSeed(body?.seed);
          const userId = normalizeUserId(body?.userId);
          const mode = normalizeMode(body?.mode);
          if (!seed || (body.type !== "up" && body.type !== "down")) {
            return new Response(JSON.stringify({ error: "invalid body" }), { status: 400, headers: jsonHeaders });
          }

          // Never record votes from practice runs.
          if (mode === "practice") {
            return new Response(JSON.stringify({ ok: false, error: "practice_disabled" }), { status: 403, headers: jsonHeaders });
          }

          // Best-effort server-side vote dedupe per user per track.
          let shouldApply = true;
          if (userId) {
            db.run("BEGIN");
            try {
              db.run("INSERT OR IGNORE INTO track_vote_events (user_id, seed, type, t) VALUES (?, ?, ?, ?)", [userId, seed, body.type, Date.now()]);
              const inserted = (db.query("SELECT changes() as c").get() as any)?.c ?? 0;
              shouldApply = inserted > 0;
              db.run("COMMIT");
            } catch {
              try {
                db.run("ROLLBACK");
              } catch {
                // ignore
              }
              // If dedupe fails, fall back to accepting the vote.
              shouldApply = true;
            }
          }

          if (shouldApply) {
            if (body.type === "up") {
              db.run(
                "INSERT INTO track_votes (seed, upvotes, downvotes) VALUES (?, 1, 0) ON CONFLICT(seed) DO UPDATE SET upvotes = upvotes + 1",
                [seed]
              );
            } else {
              db.run(
                "INSERT INTO track_votes (seed, upvotes, downvotes) VALUES (?, 0, 1) ON CONFLICT(seed) DO UPDATE SET downvotes = downvotes + 1",
                [seed]
              );
            }
          }

          const row = db.query("SELECT seed, upvotes, downvotes FROM track_votes WHERE seed = ?").get(seed) as any;
          return new Response(
            JSON.stringify({
              ok: true,
              seed,
              upvotes: typeof row?.upvotes === "number" ? row.upvotes : 0,
              downvotes: typeof row?.downvotes === "number" ? row.downvotes : 0
            }),
            { headers: jsonHeaders }
          );
        } catch {
          return new Response(JSON.stringify({ error: "json parse error" }), { status: 400, headers: jsonHeaders });
        }
      }

      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: jsonHeaders });
    }

    if (path === "/api/highscore") {
      if (req.method === "POST") {
        try {
          const body = (await req.json()) as { name?: string; score?: number; seed?: string; userId?: string; mode?: string; avgSpeedKmH?: number };
          const name = normalizeName(body?.name);
          const seed = normalizeSeed(body?.seed);
          const userId = normalizeUserId(body?.userId);
          const mode = normalizeMode(body?.mode);
          const score = Math.max(0, Math.floor(Number(body?.score ?? 0)));
          const avgSpeedKmH = Number(body?.avgSpeedKmH);
          if (!Number.isFinite(score) || score <= 0) {
            return new Response(JSON.stringify({ error: "invalid score" }), { status: 400, headers: jsonHeaders });
          }

          // Never record highscores from practice runs.
          if (mode === "practice") {
            return new Response(JSON.stringify({ ok: false, error: "practice_disabled" }), { status: 403, headers: jsonHeaders });
          }

          if (!userId) {
            return new Response(JSON.stringify({ error: "missing userId" }), { status: 400, headers: jsonHeaders });
          }

          // One score per user per seed; only keep improvements (lower time is better).
          db.run(
            "INSERT INTO high_scores (name, score, seed, user_id, mode, avg_speed_kmh, t) VALUES (?, ?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT(user_id, seed) DO UPDATE SET " +
              "name = excluded.name, " +
              "mode = excluded.mode, " +
              "avg_speed_kmh = excluded.avg_speed_kmh, " +
              "t = CASE WHEN excluded.score < high_scores.score THEN excluded.t ELSE high_scores.t END, " +
              "score = CASE WHEN excluded.score < high_scores.score THEN excluded.score ELSE high_scores.score END",
            [
              name,
              score,
              seed,
              userId,
              mode ?? "timeTrial",
              Number.isFinite(avgSpeedKmH) ? avgSpeedKmH : null,
              Date.now()
            ]
          );
          // Best-effort social post.
          void postHighScore(name, score, seed);

          return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
        } catch {
          return new Response(JSON.stringify({ error: "json parse error" }), { status: 400, headers: jsonHeaders });
        }
      }

      return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: jsonHeaders });
    }

    if (path === "/api/highscores" && req.method === "GET") {
      const seed = (url.searchParams.get("seed") ?? "").trim();
      const limitRaw = Number(url.searchParams.get("limit") ?? "10");
      const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 10));

      const rows = seed
        ? (db.query("SELECT name, score, seed, t FROM high_scores WHERE seed = ? ORDER BY score ASC LIMIT ?").all(seed, limit) as any[])
        : (db.query("SELECT name, score, seed, t FROM high_scores ORDER BY score ASC LIMIT ?").all(limit) as any[]);

      return new Response(
        JSON.stringify({
          ok: true,
          seed: seed || null,
          scores: rows.map((r) => ({
            name: typeof r?.name === "string" ? r.name : "anonymous",
            score: typeof r?.score === "number" ? r.score : 0,
            seed: typeof r?.seed === "string" ? r.seed : "0",
            t: typeof r?.t === "number" ? r.t : 0
          }))
        }),
        { headers: jsonHeaders }
      );
    }

    if (path === "/api/stats") {
      if (req.method === "POST") {
        try {
          const body = (await req.json()) as {
            type: "played" | "finished" | "wrecked";
            seed?: string;
            userId?: string;
            mode?: string;
            name?: string;
            scoreMs?: number;
            avgSpeedKmH?: number;
          };
          if (body.type !== "played" && body.type !== "finished" && body.type !== "wrecked") {
            return new Response(JSON.stringify({ error: "invalid type" }), { status: 400, headers: jsonHeaders });
          }
          const seed = normalizeSeed(body?.seed);
          const userId = normalizeUserId(body?.userId);
          const mode = normalizeMode(body?.mode);
          const name = normalizeName(body?.name);
          const scoreMs = Math.max(0, Math.floor(Number(body?.scoreMs ?? 0)));
          const avgSpeedKmH = Number(body?.avgSpeedKmH);

          db.run(
            "INSERT INTO game_stats (type, seed, user_id, mode, name, score_ms, avg_speed_kmh, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
              body.type,
              seed,
              userId || null,
              mode ?? null,
              name,
              Number.isFinite(scoreMs) && scoreMs > 0 ? scoreMs : null,
              Number.isFinite(avgSpeedKmH) ? avgSpeedKmH : null,
              Date.now()
            ]
          );
          return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
        } catch {
          return new Response(JSON.stringify({ error: "json parse error" }), { status: 400, headers: jsonHeaders });
        }
      }
    }

    if (path === "/api/landing" && req.method === "GET") {
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SCRAPS: Salvage Contracts & Risk-Adjusted Procurement Service</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;700&family=Space+Mono&display=swap" rel="stylesheet">
    <style>
        :root { --primary: #3333ff; --accent: #ff00cc; --bg: #050505; --card-bg: rgba(255, 255, 255, 0.03); }
        body { background: var(--bg); color: #ccc; font-family: 'Outfit', sans-serif; margin: 0; padding: 0; line-height: 1.6; }
        .hero { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden; padding: 2rem; text-align: center; box-sizing: border-box; }
        .hero::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: radial-gradient(circle at center, rgba(51, 51, 255, 0.1) 0%, transparent 70%); pointer-events: none; }
        
        .scraps-logo { font-family: 'Space Mono', monospace; font-weight: 700; font-size: 1.2rem; color: var(--accent); letter-spacing: 0.3rem; margin-bottom: 2rem; border: 1px solid var(--accent); padding: 0.5rem 1rem; }
        
        h1 { font-size: 3.5rem; margin: 0; font-weight: 700; letter-spacing: -0.05rem; line-height: 1.1; background: linear-gradient(to right, #fff, #888); -webkit-background-clip: text; -webkit-text-fill-color: transparent; max-width: 900px; }
        .subtitle { font-size: 1.1rem; color: #888; margin: 1.5rem 0 3rem; max-width: 600px; font-weight: 300; font-family: 'Space Mono', monospace; }
        
        .lore-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; max-width: 900px; text-align: left; margin-bottom: 4rem; z-index: 10; }
        .lore-card { background: var(--card-bg); border: 1px solid rgba(255, 255, 255, 0.1); padding: 1.5rem; border-radius: 8px; transition: border-color 0.3s; }
        .lore-card:hover { border-color: var(--primary); }
        .lore-card h3 { color: var(--primary); margin-top: 0; font-size: 0.9rem; letter-spacing: 0.1rem; text-transform: uppercase; }
        .lore-card p { margin: 0.5rem 0 0; font-size: 0.95rem; color: #aaa; }

        .cta-group { display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap; justify-content: center; }
        .btn { padding: 1rem 2rem; border-radius: 6px; font-weight: 700; text-decoration: none; transition: 0.2s; font-size: 1rem; }
        .btn-primary { background: var(--primary); color: white; border: none; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(51, 51, 255, 0.4); }
        .btn-outline { border: 1px solid #444; color: #888; }
        .btn-outline:hover { border-color: #888; color: #fff; }

        .footer-tagline { position: absolute; bottom: 2rem; font-family: 'Space Mono', monospace; font-size: 0.8rem; color: #444; }
        
        @media (max-width: 768px) {
            h1 { font-size: 2.5rem; }
            .hero { height: auto; padding-top: 8rem; padding-bottom: 8rem; }
        }
    </style>
</head>
<body>
    <div class="hero">
        <div class="scraps-logo">SCRAPS</div>
        <h1>Salvage Contracts & Risk-Adjusted Procurement Service</h1>
        <p class="subtitle">Welcome to the frontier, Contractor. <br>Your SLA is non-negotiable.</p>
        
        <div class="lore-grid">
            <div class="lore-card">
                <h3>The Mission</h3>
                <p>Run planet-side delivery routes between isolated settlements. Our spreadsheet says there are roads. Your telemetry may disagree.</p>
            </div>
            <div class="lore-card">
                <h3>Risk Adjustment</h3>
                <p>Everything outside the road is hostile. Weather, terrain, and local "biomatter" will attempt to destabilize your payload. Drive fast.</p>
            </div>
            <div class="lore-card">
                <h3>Volatile Cargo</h3>
                <p>Deliver intact for maximum payout. Stability is non-negotiable. Payout is a joke. Hazard pay is a bigger one.</p>
            </div>
        </div>

        <div class="cta-group">
            <a href="https://spacerally.supercollider.hr" class="btn btn-primary">ACCEPT CONTRACT (PLAY)</a>
            <a href="/api/stats" class="btn btn-outline">SYSTEM TELEMETRY</a>
        </div>

        <div class="footer-tagline">"Space is hard. Shipping shouldn't be." | &copy; 2026 SCRAPS CORP</div>
    </div>
</body>
</html>`;
      return new Response(html, { headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" } });
    }

    if ((path === "/stats" || path === "/api/stats") && req.method === "GET") {
      const topScores = db.query("SELECT name, score, seed FROM high_scores ORDER BY score ASC LIMIT 10").all() as any[];
      const topLiked = db.query("SELECT seed, upvotes FROM track_votes ORDER BY upvotes DESC LIMIT 5").all() as any[];
      const topDisliked = db.query("SELECT seed, downvotes FROM track_votes ORDER BY downvotes DESC LIMIT 5").all() as any[];

      const mostDriven = db
        .query(
          "SELECT seed, COUNT(*) as plays FROM game_stats WHERE type = 'played' AND (mode IS NULL OR mode != 'practice') GROUP BY seed ORDER BY plays DESC LIMIT 10"
        )
        .all() as any[];

      const fastestAvgSpeed = db
        .query(
          "SELECT seed, MAX(avg_speed_kmh) as max_speed_kmh FROM game_stats WHERE type = 'finished' AND avg_speed_kmh IS NOT NULL AND (mode IS NULL OR mode != 'practice') GROUP BY seed ORDER BY max_speed_kmh DESC LIMIT 10"
        )
        .all() as any[];

      const usersByAvgSpeed = db
        .query(
          "SELECT user_id, MAX(name) as name, AVG(avg_speed_kmh) as avg_speed_kmh, COUNT(*) as finishes FROM game_stats WHERE type = 'finished' AND user_id IS NOT NULL AND user_id != '' AND avg_speed_kmh IS NOT NULL AND (mode IS NULL OR mode != 'practice') GROUP BY user_id ORDER BY avg_speed_kmh DESC LIMIT 20"
        )
        .all() as any[];

      const worstOutcomes = db
        .query(
          "WITH agg AS (" +
            " SELECT seed, " +
            "   SUM(CASE WHEN type = 'played' THEN 1 ELSE 0 END) as played, " +
            "   SUM(CASE WHEN type = 'finished' THEN 1 ELSE 0 END) as finished, " +
            "   SUM(CASE WHEN type = 'wrecked' THEN 1 ELSE 0 END) as wrecked " +
            " FROM game_stats " +
            " WHERE (mode IS NULL OR mode != 'practice') " +
            " GROUP BY seed" +
            ") " +
            "SELECT seed, played, finished, wrecked, " +
            "  CASE WHEN played > 0 THEN CAST(wrecked AS REAL) / played ELSE 0 END as wrecked_rate, " +
            "  CASE WHEN played > 0 THEN CAST(played - finished AS REAL) / played ELSE 0 END as not_finished_rate " +
            "FROM agg " +
            "WHERE played >= 5 " +
            "ORDER BY wrecked_rate DESC, not_finished_rate DESC " +
            "LIMIT 10"
        )
        .all() as any[];

      const todayStart = new Date().setHours(0, 0, 0, 0);
      const playedToday = (db.query("SELECT COUNT(*) as count FROM game_stats WHERE type = 'played' AND t >= ?").get(todayStart) as any)?.count ?? 0;
      const totalFinished = (db.query("SELECT COUNT(*) as count FROM game_stats WHERE type = 'finished'").get() as any)?.count ?? 0;
      const totalWrecked = (db.query("SELECT COUNT(*) as count FROM game_stats WHERE type = 'wrecked'").get() as any)?.count ?? 0;

      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SCRAPS - System Telemetry</title>
    <style>
        body { background: #050510; color: #eee; font-family: 'Outfit', sans-serif; padding: 2rem; max-width: 1000px; margin: auto; }
        h1 { text-align: center; color: #ff00cc; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 2rem; }
        .card { background: rgba(255, 255, 255, 0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1); }
        h2 { border-bottom: 2px solid #3333ff; padding-bottom: 0.5rem; margin-top: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
        .stats-summary { display: flex; justify-content: space-around; margin-bottom: 2rem; }
        .stat-box { text-align: center; }
        .stat-value { font-size: 2rem; font-weight: bold; color: #3333ff; }
        .stat-label { color: #888; font-size: 0.9rem; }
        .seed { font-family: monospace; color: #00ffaa; }
    </style>
</head>
<body>
    <h1>Dashboard</h1>
    
    <div class="stats-summary">
        <div class="stat-box">
            <div class="stat-value">${playedToday}</div>
            <div class="stat-label">Games Played Today</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${totalFinished}</div>
            <div class="stat-label">Total Completed</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${totalWrecked}</div>
            <div class="stat-label">Total Wrecked</div>
        </div>
    </div>

    <div class="grid">
        <div class="card" style="grid-column: span 2;">
            <h2>Top 10 Fast Laps</h2>
            <table>
                <thead><tr><th>Rank</th><th>Name</th><th>Time (s)</th><th>Track Seed</th></tr></thead>
                <tbody>
                    ${topScores.map((s, i) => `<tr><td>${i + 1}</td><td>${s.name}</td><td>${(s.score / 1000).toFixed(3)}</td><td class="seed">${s.seed}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="card">
            <h2>Hottest Tracks</h2>
            <table>
                <thead><tr><th>Seed</th><th>Likes</th></tr></thead>
                <tbody>
                    ${topLiked.map(s => `<tr><td class="seed">${s.seed}</td><td>👍 ${s.upvotes}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>Coldest Tracks</h2>
            <table>
                <thead><tr><th>Seed</th><th>Dislikes</th></tr></thead>
                <tbody>
                    ${topDisliked.map(s => `<tr><td class="seed">${s.seed}</td><td>👎 ${s.downvotes}</td></tr>`).join('')}
                </tbody>
            </table>
        </div>

        <div class="card" style="grid-column: span 2;">
          <h2>Most Driven Tracks</h2>
          <table>
            <thead><tr><th>Seed</th><th>Drives</th></tr></thead>
            <tbody>
              ${mostDriven.map(s => `<tr><td class="seed">${s.seed}</td><td>${s.plays}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="card" style="grid-column: span 2;">
          <h2>Fastest Average Speed (By Track)</h2>
          <table>
            <thead><tr><th>Seed</th><th>Max Avg Speed (km/h)</th></tr></thead>
            <tbody>
              ${fastestAvgSpeed.map(s => `<tr><td class="seed">${s.seed}</td><td>${Number(s.max_speed_kmh ?? 0).toFixed(1)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="card" style="grid-column: span 2;">
          <h2>Fastest Contractors Overall (By Avg Speed Across All Driven Tracks)</h2>
          <table>
            <thead><tr><th>Name</th><th>Avg Speed (km/h)</th><th>Finishes</th></tr></thead>
            <tbody>
              ${usersByAvgSpeed.map(s => `<tr><td>${(s.name ?? 'anonymous')}</td><td>${Number(s.avg_speed_kmh ?? 0).toFixed(1)}</td><td>${s.finishes}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>

        <div class="card" style="grid-column: span 2;">
          <h2>Highest Wreck / Not-Finished Rate (By Track)</h2>
          <table>
            <thead><tr><th>Seed</th><th>Played</th><th>Finished</th><th>Wrecked</th><th>Wreck Rate</th><th>Not-Finished Rate</th></tr></thead>
            <tbody>
              ${worstOutcomes
                .map(s => `<tr><td class="seed">${s.seed}</td><td>${s.played}</td><td>${s.finished}</td><td>${s.wrecked}</td><td>${(Number(s.wrecked_rate ?? 0) * 100).toFixed(1)}%</td><td>${(Number(s.not_finished_rate ?? 0) * 100).toFixed(1)}%</td></tr>`)
                .join('')}
            </tbody>
          </table>
        </div>
    </div>
    
    <div style="text-align: center; margin-top: 2rem;">
        <a href="/api/landing" style="color: #ff00cc; text-decoration: none;">← Back to Landing Page</a>
    </div>
</body>
</html>`;
      return new Response(html, { headers: { ...corsHeaders, "content-type": "text/html; charset=utf-8" } });
    }

    if (path === "/api/backup" && req.method === "GET") {
      const backupPath = `backup-${Date.now()}.sqlite`;
      try {
        // Safe hot backup using VACUUM INTO
        db.run(`VACUUM INTO '${backupPath}'`);
        const file = Bun.file(backupPath);
        return new Response(file, {
          headers: {
            ...corsHeaders,
            "content-type": "application/x-sqlite3",
            "content-disposition": `attachment; filename="${backupPath}"`
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "backup failed", details: String(e) }), { status: 500, headers: jsonHeaders });
      }
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

      // Lightweight keepalive / RTT measurement to the signaling server.
      // Reply directly and do not broadcast.
      if (parsed.type === "ping") {
        const echo = typeof (parsed as any).t === "number" ? (parsed as any).t : null;
        sendJson(ws, { type: "pong", echo, t: nowMs() });
        return;
      }

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
