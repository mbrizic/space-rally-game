#!/usr/bin/env node

import WebSocket from "ws";

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    timeout
  ]);
}

function parseArgs(argv) {
  const args = { signal: null, json: false, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--signal" || a === "--signalWs" || a === "--signal-ws") {
      args.signal = argv[++i] ?? null;
    }
  }
  return args;
}

function resolveSignalWsEndpoints(override) {
  if (!override) throw new Error("missing --signal (expected https://host or wss://host/api/ws)");

  if (override.startsWith("ws://") || override.startsWith("wss://")) return [override];

  if (override.startsWith("http://") || override.startsWith("https://")) {
    const u = new URL(override);
    const hasWsPath = u.pathname.endsWith("/ws") || u.pathname.endsWith("/api/ws");

    // If the caller provided a full path, respect it (and just ws-ify it).
    if (hasWsPath) return [u.toString().replace(/^http/, "ws")];

    // If they passed a bare origin (or a non-ws path), try the common endpoints.
    // The game defaults to /api/ws (same-origin). Some deployments also expose /ws.
    const base = new URL(u.toString());
    base.search = "";
    base.hash = "";

    const apiWs = new URL(base.toString());
    apiWs.pathname = "/api/ws";

    const ws = new URL(base.toString());
    ws.pathname = "/ws";

    return [apiWs.toString().replace(/^http/, "ws"), ws.toString().replace(/^http/, "ws")];
  }

  throw new Error("--signal must start with http(s):// or ws(s)://");
}

function resolveSignalHttpOrigin(signalWs) {
  if (signalWs.startsWith("ws://") || signalWs.startsWith("wss://")) {
    return signalWs.replace(/^ws/, "http").replace(/\/(ws|api\/ws)\/?$/, "");
  }
  throw new Error("signalWs must be ws(s)://");
}

function wsUrl(signalWs, room, peer, create) {
  const u = new URL(signalWs);
  u.searchParams.set("room", room);
  u.searchParams.set("peer", peer);
  if (create) u.searchParams.set("create", "1");
  return u.toString();
}

function randomRoomCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function randomPeer(prefix) {
  return `${prefix}_${Math.floor(Math.random() * 1e9)}`;
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // ignore
    }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

function waitForWsMessage(ws, pred, ms, label) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        try {
          if (pred(msg)) {
            cleanup();
            resolve(msg);
          }
        } catch (e) {
          cleanup();
          reject(e);
        }
      };
      const onError = (e) => {
        cleanup();
        reject(e);
      };
      const cleanup = () => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("error", onError);
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
    }),
    ms,
    label
  );
}

async function openWs(url, ms, label) {
  const ws = new WebSocket(url);
  await withTimeout(
    new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(undefined), { once: true });
      ws.addEventListener("error", (e) => reject(e), { once: true });
    }),
    ms,
    label
  );
  return ws;
}

async function main() {
  const args = parseArgs(process.argv);

  const started = nowMs();
  const report = {
    ok: false,
    signalWs: null,
    signalHttpOrigin: null,
    steps: [],
    durationMs: 0
  };

  const step = async (name, fn) => {
    const s = { name, ok: false, durationMs: 0, details: null };
    const t0 = nowMs();
    try {
      const details = await fn();
      s.ok = true;
      s.details = details ?? null;
    } catch (e) {
      s.ok = false;
      s.details = { error: String(e?.message ?? e) };
      throw Object.assign(new Error(`step failed: ${name}: ${s.details.error}`), { _healthStep: s });
    } finally {
      s.durationMs = nowMs() - t0;
      report.steps.push(s);
    }
  };

  try {
    const signalWsCandidates = resolveSignalWsEndpoints(args.signal);
    const signalWs = signalWsCandidates[0];
    const signalHttpOrigin = resolveSignalHttpOrigin(signalWs);
    report.signalWs = signalWs;
    report.signalHttpOrigin = signalHttpOrigin;

    await step("health endpoint", async () => {
      const u = new URL("/health", signalHttpOrigin).toString();
      const res = await fetchText(u, 1500);
      return { url: u, status: res.status, ok: res.ok, body: res.text.slice(0, 200) };
    });

    await step("turn endpoint", async () => {
      const peer = randomPeer("hc");
      const u = new URL("/api/turn", signalHttpOrigin);
      u.searchParams.set("peer", peer);
      const res = await fetchJson(u.toString(), 1500);
      const hasIceServers = !!(res.json && res.json.ok === true && Array.isArray(res.json.iceServers));
      return {
        url: u.toString(),
        status: res.status,
        ok: res.ok,
        hasIceServers,
        iceServersCount: Array.isArray(res.json?.iceServers) ? res.json.iceServers.length : 0
      };
    });

    await step("signaling create+join", async () => {
      const room = randomRoomCode();
      const hostPeer = randomPeer("host");
      const clientPeer = randomPeer("client");

      let chosen = null;
      let hostWs = null;
      let lastErr = null;
      for (const cand of signalWsCandidates) {
        try {
          hostWs = await openWs(wsUrl(cand, room, hostPeer, true), 2000, `ws host open (${cand})`);
          chosen = cand;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!hostWs || !chosen) throw lastErr ?? new Error("failed to open host ws");

      const welcomeHost = await waitForWsMessage(hostWs, (m) => m?.type === "welcome", 2000, "ws host welcome");

      const clientWs = await openWs(wsUrl(chosen, room, clientPeer, false), 2000, "ws client open");
      const welcomeClient = await waitForWsMessage(clientWs, (m) => m?.type === "welcome", 2000, "ws client welcome");

      const joined = await waitForWsMessage(hostWs, (m) => m?.type === "peer-joined", 2000, "ws peer-joined");

      try { hostWs.close(); } catch {}
      try { clientWs.close(); } catch {}

      return {
        signalWsUsed: chosen,
        room,
        hostPeer,
        clientPeer,
        welcomeHost: { room: welcomeHost?.room, peer: welcomeHost?.peer },
        welcomeClient: { room: welcomeClient?.room, peer: welcomeClient?.peer },
        peerJoined: { peer: joined?.peer }
      };
    });

    await step("signaling join missing room errors", async () => {
      const room = randomRoomCode();
      const clientPeer = randomPeer("client");

      // Use the first candidate; if the cluster exposes only one endpoint, it should be in the list.
      // If both exist, either is fine.
      const ws = await openWs(wsUrl(signalWsCandidates[0], room, clientPeer, false), 2000, "ws open (missing room)");
      const err = await waitForWsMessage(ws, (m) => m?.type === "error", 2000, "ws error (missing room)");
      try { ws.close(); } catch {}

      return { room, code: err?.code ?? null };
    });

    report.ok = report.steps.every((s) => s.ok);
  } catch (e) {
    report.ok = false;
  } finally {
    report.durationMs = nowMs() - started;
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
    console.log(`net healthcheck: ${report.ok ? "OK" : "FAIL"} (${report.durationMs}ms)`);
    console.log(`signalWs: ${report.signalWs}`);
    console.log(`signalHttpOrigin: ${report.signalHttpOrigin}`);
    for (const s of report.steps) {
      console.log(`- ${pad(s.name, 28)} ${s.ok ? "ok" : "FAIL"} (${s.durationMs}ms)`);
      if (!s.ok) console.log(`  ${JSON.stringify(s.details)}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
