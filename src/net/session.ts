import type { Game } from "../runtime/game";
import { PlayerRole } from "../runtime/game";

type NetState = {
  room: string;
  peer: string;
  remotePeer: string | null;
  wsConnected: boolean;
  dcState: string;
  lastError: string | null;
  mode: "offline" | "host" | "client";
};

type NetStats = {
  wsRttMs: number | null;
  wsRttEmaMs: number | null;
  dcRxHz: number | null;
  dcTxHz: number | null;
  dcLastRxAtMs: number | null;
};

type WelcomeMsg = {
  type: "welcome";
  room: string;
  peer: string;
  peers: string[];
};

type PeerEventMsg =
  | { type: "peer-joined"; peer: string }
  | { type: "peer-left"; peer: string };

type OfferMsg = { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit };
type AnswerMsg = { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit };
type IceMsg = { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };
type RestartIceMsg = { type: "restart-ice"; from: string; to: string; reason?: string };
type ErrorMsg = { type: "error"; code: string; to?: string };

type ServerMsg =
  | WelcomeMsg
  | PeerEventMsg
  | OfferMsg
  | AnswerMsg
  | IceMsg
  | RestartIceMsg
  | ErrorMsg
  | { type: string;[k: string]: unknown };

// (share-link style room ids removed; multiplayer uses 4-digit numeric codes)

function resolveSignalWsEndpoint(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("signal") ?? url.searchParams.get("signalWs");
  if (override) {
    if (override.startsWith("ws://") || override.startsWith("wss://")) return override;
    if (override.startsWith("http://") || override.startsWith("https://")) {
      const u = new URL(override);
      if (!u.pathname.endsWith("/ws") && !u.pathname.endsWith("/api/ws")) u.pathname = "/ws";
      return u.toString().replace(/^http/, "ws");
    }
  }
  const u = new URL("/api/ws", window.location.origin);
  return u.toString().replace(/^http/, "ws");
}

function wsUrl(room: string, peer: string, create: boolean): string {
  const u = new URL(resolveSignalWsEndpoint());
  u.searchParams.set("room", room);
  u.searchParams.set("peer", peer);
  if (create) u.searchParams.set("create", "1");
  return u.toString();
}

function resolveSignalHttpOrigin(): string {
  // Prefer explicit signaling override, otherwise same-origin.
  const url = new URL(window.location.href);
  const override = url.searchParams.get("signal") ?? url.searchParams.get("signalWs");
  if (override) {
    if (override.startsWith("ws://") || override.startsWith("wss://")) {
      return override.replace(/^ws/, "http").replace(/\/(ws|api\/ws)\/?$/, "");
    }
    if (override.startsWith("http://") || override.startsWith("https://")) {
      const u = new URL(override);
      // Strip /ws or /api/ws if provided.
      u.pathname = u.pathname.replace(/\/(ws|api\/ws)\/?$/, "");
      u.search = "";
      return u.toString();
    }
  }
  return window.location.origin;
}

async function fetchTurnIceServers(peer: string): Promise<RTCIceServer[] | null> {
  try {
    const base = resolveSignalHttpOrigin();
    const u = new URL("/api/turn", base);
    u.searchParams.set("peer", peer);

    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(u.toString(), { signal: ctrl.signal });
    window.clearTimeout(t);
    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json || json.ok !== true || !Array.isArray(json.iceServers)) return null;
    return json.iceServers as RTCIceServer[];
  } catch {
    return null;
  }
}

function resolveSignalHealthUrl(): string {
  const ws = resolveSignalWsEndpoint();
  if (ws.startsWith("ws://") || ws.startsWith("wss://")) {
    const http = ws.replace(/^ws/, "http");
    const u = new URL(http);
    u.pathname = "/health";
    u.search = "";
    return u.toString();
  }
  return "/api/health";
}

export function initNetSession(
  game: Game,
  opts?: {
    onPeerConnected?: (mode: "host" | "client") => void;
    onPeerReady?: (mode: "host" | "client") => void;
    onPeerDisconnected?: () => void;
  }
): {
  host: () => Promise<string>;
  join: (roomCode: string) => Promise<void>;
  reconnectHost: (roomCode: string) => Promise<void>;
  reconnectClient: (roomCode: string) => Promise<void>;
  disconnect: () => void;
  isPeerReady: () => boolean;
} {
  const statusEl = document.getElementById("net-status") as HTMLDivElement | null;

  const state: NetState = {
    room: "",
    peer: "",
    remotePeer: null,
    wsConnected: false,
    dcState: "closed",
    lastError: null,
    mode: "offline"
  };

  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let pingTimer: number | null = null;
  let statsTimer: number | null = null;
  let hostSendTimer: number | null = null;
  let clientSendTimer: number | null = null;
  let connectWatchdogTimer: number | null = null;
  let offerRestartCount = 0;
  let pendingIce: RTCIceCandidateInit[] = [];
  let peerReady = false;

  const stats: NetStats = {
    wsRttMs: null,
    wsRttEmaMs: null,
    dcRxHz: null,
    dcTxHz: null,
    dcLastRxAtMs: null
  };

  let wsPingSentAtMs: number | null = null;
  let dcRxCount = 0;
  let dcTxCount = 0;

  let hostRole: PlayerRole = PlayerRole.DRIVER;
  let clientRole: PlayerRole = PlayerRole.NAVIGATOR;

  const render = (): void => {
    const rtt = stats.wsRttEmaMs ?? stats.wsRttMs;
    const rxAgeMs = stats.dcLastRxAtMs ? Math.max(0, Date.now() - stats.dcLastRxAtMs) : null;
    const lines = [
      `mode: ${state.mode}`,
      `room: ${state.room || "-"}`,
      `ws: ${state.wsConnected ? "up" : "down"}`,
      `p2p: ${state.dcState}`,
      rtt !== null ? `rtt: ${Math.round(rtt)}ms (signal)` : "",
      stats.dcRxHz !== null ? `snap rx: ${stats.dcRxHz.toFixed(1)} Hz` : "",
      stats.dcTxHz !== null ? `snap tx: ${stats.dcTxHz.toFixed(1)} Hz` : "",
      rxAgeMs !== null ? `last rx: ${(rxAgeMs / 1000).toFixed(1)}s` : "",
      state.lastError ? `err: ${state.lastError}` : ""
    ].filter(Boolean);

    if (statusEl) statusEl.textContent = lines.join("\n");
    game.setNetStatusLines(lines);
  };

  const setError = (msg: string | null): void => {
    state.lastError = msg;
    render();
  };

  const resetP2p = (): void => {
    if (hostSendTimer) window.clearInterval(hostSendTimer);
    if (clientSendTimer) window.clearInterval(clientSendTimer);
    if (connectWatchdogTimer) window.clearTimeout(connectWatchdogTimer);
    if (statsTimer) window.clearInterval(statsTimer);
    hostSendTimer = null;
    clientSendTimer = null;
    connectWatchdogTimer = null;
    statsTimer = null;
    offerRestartCount = 0;
    pendingIce = [];
    peerReady = false;
    stats.dcRxHz = null;
    stats.dcTxHz = null;
    stats.dcLastRxAtMs = null;
    dcRxCount = 0;
    dcTxCount = 0;
    opts?.onPeerDisconnected?.();
    game.setNetShootPulseHandler(null);
    try { dc?.close(); } catch { }
    try { pc?.close(); } catch { }
    dc = null;
    pc = null;
    state.dcState = "closed";
    render();
  };

  const isOfferer = (): boolean => {
    return !!state.remotePeer && state.peer < state.remotePeer;
  };

  const flushPendingIce = async (pc0: RTCPeerConnection): Promise<void> => {
    // Some browsers will reject addIceCandidate until a remote description exists.
    if (!pc0.remoteDescription) return;
    if (pendingIce.length === 0) return;
    const toAdd = pendingIce;
    pendingIce = [];
    for (const cand of toAdd) {
      try {
        await pc0.addIceCandidate(cand);
      } catch {
        // ignore
      }
    }
  };

  const doIceRestartAsOfferer = async (reason: string): Promise<void> => {
    if (!state.remotePeer) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isOfferer()) return;
    if (offerRestartCount >= 2) return;
    offerRestartCount++;

    const pc0 = await ensurePc(state.remotePeer);
    if (!dc) {
      // Ensure the offerer owns the datachannel.
      dc = pc0.createDataChannel("data");
      wireDc();
    }

    try {
      const offer = await pc0.createOffer({ iceRestart: true });
      await pc0.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", to: state.remotePeer, sdp: offer, reason }));
    } catch {
      setError("ice restart failed");
    }
  };

  const requestIceRestart = (reason: string): void => {
    if (!state.remotePeer) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (dc?.readyState === "open") return;

    if (isOfferer()) {
      void doIceRestartAsOfferer(reason);
    } else {
      // Ask the offerer to do an ICE-restart offer.
      try {
        ws.send(JSON.stringify({ type: "restart-ice", to: state.remotePeer, reason }));
      } catch {
        // ignore
      }
    }
  };

  const armConnectWatchdog = (): void => {
    if (connectWatchdogTimer) window.clearTimeout(connectWatchdogTimer);
    connectWatchdogTimer = window.setTimeout(() => {
      // If the signaling link is up but the datachannel still isn't open, prod the connection.
      if (!state.remotePeer) return;
      if (dc?.readyState === "open") return;
      requestIceRestart("watchdog");
    }, 8000);
  };

  const ensurePc = async (remotePeer: string): Promise<RTCPeerConnection> => {
    if (pc) return pc;

    // Baseline STUN (works for many NATs).
    const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

    // Optional TURN (coturn) for strict NATs/corporate networks.
    const turn = await fetchTurnIceServers(state.peer || remotePeer);
    if (turn && turn.length > 0) iceServers.push(...turn);

    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
      if (!e.candidate || !ws || ws.readyState !== WebSocket.OPEN || !state.remotePeer) return;
      ws.send(JSON.stringify({ type: "ice", to: state.remotePeer, candidate: e.candidate.toJSON() }));
    };

    pc.onconnectionstatechange = () => render();

    pc.oniceconnectionstatechange = () => {
      render();
      const s = pc?.iceConnectionState;
      if (s === "failed") {
        requestIceRestart("ice-failed");
      }
    };

    pc.ondatachannel = (e) => {
      dc = e.channel;
      wireDc();
    };

    state.remotePeer = remotePeer;
    render();
    return pc;
  };

  const wireDc = (): void => {
    if (!dc) return;
    state.dcState = dc.readyState;
    render();

    dc.onopen = () => {
      state.dcState = dc?.readyState ?? "open";
      render();
      if (!dc) return;

      if (statsTimer) window.clearInterval(statsTimer);
      // Update snapshot rates once per second.
      statsTimer = window.setInterval(() => {
        // Host sends 30Hz snapshots; client sends 30Hz nav/driver messages.
        const rx = dcRxCount;
        const tx = dcTxCount;
        dcRxCount = 0;
        dcTxCount = 0;
        stats.dcRxHz = rx;
        stats.dcTxHz = tx;
        render();
      }, 1000);

      if (connectWatchdogTimer) {
        window.clearTimeout(connectWatchdogTimer);
        connectWatchdogTimer = null;
      }

      if (state.mode === "host") {
        game.setNetMode("host");
        game.setRoleExternal(hostRole);
        try {
          dc.send(JSON.stringify({ type: "init", trackDef: game.getSerializedTrackDef(), hostRole }));
        } catch { }

        hostSendTimer = window.setInterval(() => {
          if (!dc || dc.readyState !== "open") return;
          try {
            dc.send(JSON.stringify({ type: "state", ...game.getNetSnapshot() }));
            dcTxCount += 1;
          } catch { }
        }, 33);

        opts?.onPeerConnected?.("host");
      }

      if (state.mode === "client") {
        game.setNetMode("client");
        game.setRoleExternal(clientRole);
        // shootPulse is no longer used - client handles shooting locally
        game.setNetShootPulseHandler(null);

        // Wait to send READY until we've received init/trackDef.

        clientSendTimer = window.setInterval(() => {
          if (!dc || dc.readyState !== "open") return;

          if (game.getRoleExternal() === PlayerRole.NAVIGATOR) {
            const aim = game.getAimWorld();
            const damageEvents = game.getAndClearClientDamageEvents();
            const projectiles = game.getClientProjectiles();
            const payload = {
              type: "nav",
              aimX: aim.x,
              aimY: aim.y,
              shootHeld: game.getNavigatorShootHeld(),
              weaponIndex: game.getCurrentWeaponIndex(),
              // Client-authoritative damage events (hits from client's projectiles)
              damageEvents: damageEvents.length > 0 ? damageEvents : undefined,
              // Send projectile positions for rendering on host
              projectiles: projectiles.length > 0 ? projectiles : undefined
            };
            try { dc.send(JSON.stringify(payload)); dcTxCount += 1; } catch { }
          } else if (game.getRoleExternal() === PlayerRole.DRIVER) {
            const payload = {
              type: "driver",
              input: game.getInputStateExternal()
            };
            try { dc.send(JSON.stringify(payload)); dcTxCount += 1; } catch { }
          }
        }, 33);

        opts?.onPeerConnected?.("client");
      }
    };
    dc.onclose = () => {
      state.dcState = dc?.readyState ?? "closed";
      render();
    };
    dc.onerror = () => {
      state.dcState = dc?.readyState ?? "error";
      render();
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }

      // Snapshot stats
      stats.dcLastRxAtMs = Date.now();
      if (typeof msg?.type === "string") {
        if (msg.type === "state") dcRxCount += 1;
      }

      if (msg?.type === "ready" && state.mode === "host") {
        peerReady = true;
        game.notify("Client connected");
        opts?.onPeerReady?.("host");
        return;
      }

      if (msg?.type === "init" && state.mode === "client") {
        const ok = typeof msg.trackDef === "string" ? game.loadSerializedTrackDef(msg.trackDef) : false;
        if (!ok) {
          setError("bad trackDef");
          return;
        }

        const hr = msg.hostRole === PlayerRole.DRIVER ? PlayerRole.DRIVER : PlayerRole.NAVIGATOR;
        clientRole = hr === PlayerRole.DRIVER ? PlayerRole.NAVIGATOR : PlayerRole.DRIVER;
        game.setRoleExternal(clientRole);

        // Now tell the host we're actually in-game (so host can start sim).
        try {
          dc?.send(JSON.stringify({ type: "ready" }));
        } catch { }

        peerReady = true;
        game.notify("Connected");
        opts?.onPeerReady?.("client");
        return;
      }

      if (msg?.type === "state" && state.mode === "client") {
        if (msg && typeof msg.t === "number" && msg.car) {
          game.applyNetSnapshot(msg);
        }
        return;
      }

      if (msg?.type === "nav" && state.mode === "host") {
        if (!msg) return;
        game.applyRemoteNavigatorInput({
          aimX: typeof msg.aimX === "number" ? msg.aimX : 0,
          aimY: typeof msg.aimY === "number" ? msg.aimY : 0,
          shootHeld: !!msg.shootHeld,
          shootPulse: false, // No longer used - client handles shooting
          weaponIndex: typeof msg.weaponIndex === "number" ? msg.weaponIndex : 0
        });
        // Process damage events from client (client-authoritative shooting)
        if (Array.isArray(msg.damageEvents) && msg.damageEvents.length > 0) {
          game.applyRemoteDamageEvents(msg.damageEvents);
        }
        // Apply projectile positions from client for rendering on host
        if (Array.isArray(msg.projectiles)) {
          game.applyRemoteNavigatorProjectiles(msg.projectiles);
        } else {
          game.applyRemoteNavigatorProjectiles([]);
        }
        return;
      }

      if (msg?.type === "driver" && state.mode === "host") {
        if (msg.input) {
          game.applyRemoteDriverInput(msg.input);
        }
        return;
      }
    };
  };

  const maybeStartOffer = async (): Promise<void> => {
    if (!state.remotePeer) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!isOfferer()) {
      // Still arm watchdog so we can request restart if things stall.
      armConnectWatchdog();
      return;
    }

    const pc0 = await ensurePc(state.remotePeer);
    if (!dc) {
      dc = pc0.createDataChannel("data");
      wireDc();
    }

    try {
      const offer = await pc0.createOffer();
      await pc0.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", to: state.remotePeer, sdp: offer }));
      armConnectWatchdog();
    } catch (e) {
      setError(`offer failed`);
    }
  };

  const connectWithMode = (room: string, create: boolean): Promise<void> => {
    const cleanRoom = room.trim().toUpperCase();
    if (!cleanRoom) return Promise.reject(new Error("bad room"));

    setError(null);
    state.room = cleanRoom;
    state.remotePeer = null;
    resetP2p();

    if (!state.peer) state.peer = `p_${Math.random().toString(36).slice(2, 10)}`;

    if (ws) {
      try { ws.close(); } catch { }
      ws = null;
    }

    const url = wsUrl(state.room, state.peer, create);
    ws = new WebSocket(url);

    fetch(resolveSignalHealthUrl())
      .then((r) => r.ok ? r.text() : Promise.reject())
      .catch(() => {
        setError("signal health failed");
      });

    ws.onopen = () => {
      state.wsConnected = true;
      setError(null);
      render();
      if (pingTimer) window.clearInterval(pingTimer);
      // Initial ping for fast RTT.
      wsPingSentAtMs = Date.now();
      try { ws?.send(JSON.stringify({ type: "ping", t: wsPingSentAtMs })); } catch { }
      pingTimer = window.setInterval(() => {
        wsPingSentAtMs = Date.now();
        try { ws?.send(JSON.stringify({ type: "ping", t: wsPingSentAtMs })); } catch { }
      }, 10_000);
    };

    ws.onclose = (_e) => {
      state.wsConnected = false;
      render();
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = null;
      wsPingSentAtMs = null;
      resetP2p();
    };

    ws.onerror = () => setError("ws error");

    let didResolve = false;
    let resolveOnce: (() => void) | null = null;
    let rejectOnce: ((e: any) => void) | null = null;
    const p = new Promise<void>((resolve, reject) => {
      resolveOnce = () => {
        if (didResolve) return;
        didResolve = true;
        resolve();
      };
      rejectOnce = (e) => {
        if (didResolve) return;
        didResolve = true;
        reject(e);
      };
    });

    ws.onmessage = async (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }

      if (msg.type === "pong") {
        const echo = typeof (msg as any).echo === "number" ? (msg as any).echo : null;
        const sentAt = echo ?? wsPingSentAtMs;
        if (typeof sentAt === "number") {
          const rttMs = Math.max(0, Date.now() - sentAt);
          stats.wsRttMs = rttMs;
          stats.wsRttEmaMs = stats.wsRttEmaMs === null ? rttMs : (stats.wsRttEmaMs * 0.8 + rttMs * 0.2);
          render();
        }
        return;
      }

      if (msg.type === "error") {
        const code = (msg as ErrorMsg).code;
        setError(code);
        if (code === "ROOM_NOT_FOUND") {
          rejectOnce?.(new Error("ROOM_NOT_FOUND"));
        } else if (code === "ROOM_TAKEN") {
          rejectOnce?.(new Error("ROOM_TAKEN"));
        }
        return;
      }

      if (msg.type === "welcome") {
        const peers = (msg as WelcomeMsg).peers ?? [];
        resolveOnce?.();
        if (peers.length > 0) {
          state.remotePeer = peers[0];
          render();
          await maybeStartOffer();
        }
        return;
      }

      if (msg.type === "peer-joined") {
        const p = (msg as any).peer as string | undefined;
        if (p && p !== state.peer && !state.remotePeer) {
          state.remotePeer = p;
          render();
          await maybeStartOffer();
        }
        return;
      }

      if (msg.type === "peer-left") {
        const p = (msg as any).peer as string | undefined;
        if (p && p === state.remotePeer) {
          state.remotePeer = null;
          resetP2p();
          render();
        }
        return;
      }

      if (msg.type === "offer") {
        const m = msg as OfferMsg;
        if (m.to !== state.peer) return;
        state.remotePeer = m.from;
        render();

        // Reset offer retry counter on new offer.
        offerRestartCount = 0;

        const pc0 = await ensurePc(m.from);
        try {
          await pc0.setRemoteDescription(m.sdp);
          await flushPendingIce(pc0);
          const answer = await pc0.createAnswer();
          await pc0.setLocalDescription(answer);
          ws?.send(JSON.stringify({ type: "answer", to: m.from, sdp: answer }));
          armConnectWatchdog();
        } catch (e) { setError("answer failed"); }
        return;
      }

      if (msg.type === "answer") {
        const m = msg as AnswerMsg;
        if (m.to !== state.peer) return;
        const pc0 = await ensurePc(m.from);
        try {
          await pc0.setRemoteDescription(m.sdp);
          await flushPendingIce(pc0);
          armConnectWatchdog();
        } catch (e) {
          setError("answer failed");
        }
        return;
      }

      if (msg.type === "ice") {
        const m = msg as IceMsg;
        if (m.to !== state.peer) return;
        const pc0 = await ensurePc(m.from);
        if (!pc0.remoteDescription) {
          pendingIce.push(m.candidate);
          return;
        }
        try { await pc0.addIceCandidate(m.candidate); } catch { }
        return;
      }

      if (msg.type === "restart-ice") {
        const m = msg as RestartIceMsg;
        if (m.to !== state.peer) return;
        // Only the designated offerer should perform an ICE restart.
        state.remotePeer = m.from;
        render();
        if (isOfferer()) {
          void doIceRestartAsOfferer(typeof m.reason === "string" ? m.reason : "remote-request");
        }
        return;
      }

      if (msg.type === "error") {
        setError((msg as ErrorMsg).code);
      }
    };

    render();
    return p;
  };

  const normalize4DigitCode = (s: string): string | null => {
    const digits = (s ?? "").replace(/\D/g, "").slice(0, 4);
    if (digits.length !== 4) return null;
    return digits;
  };

  const disconnect = (): void => {
    state.mode = "offline";
    state.room = "";
    state.remotePeer = null;
    setError(null);
    try { ws?.close(); } catch { }
    ws = null;
    resetP2p();
    game.setNetMode("solo");
    game.setNetWaitForPeer(false);
    render();
  };

  const reconnectHost = async (roomCode: string): Promise<void> => {
    hostRole = PlayerRole.DRIVER;
    clientRole = PlayerRole.NAVIGATOR;

    state.mode = "host";
    game.setNetMode("host");
    game.setRoleExternal(hostRole);
    game.setNetWaitForPeer(true);

    const code = normalize4DigitCode(roomCode);
    if (!code) throw new Error("BAD_CODE");

    // Prefer re-joining an existing room (create=0). If it expired, recreate it.
    try {
      await connectWithMode(code, false);
      return;
    } catch (e: any) {
      if (String(e?.message ?? e) !== "ROOM_NOT_FOUND") throw e;
    }

    await connectWithMode(code, true);
  };

  const reconnectClient = async (roomCode: string): Promise<void> => {
    await join(roomCode);
  };

  const host = async (): Promise<string> => {
    hostRole = PlayerRole.DRIVER;
    clientRole = PlayerRole.NAVIGATOR;

    state.mode = "host";
    game.setNetMode("host");
    game.setRoleExternal(hostRole);
    game.setNetWaitForPeer(true);

    // Try a few random 4-digit codes until we find a free one.
    for (let attempt = 0; attempt < 25; attempt++) {
      const code = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      try {
        await connectWithMode(code, true);
        return code;
      } catch (e: any) {
        if (String(e?.message ?? e) === "ROOM_TAKEN") continue;
        throw e;
      }
    }

    throw new Error("NO_FREE_CODE");
  };

  const join = async (roomCode: string): Promise<void> => {
    const code = normalize4DigitCode(roomCode);
    if (!code) throw new Error("BAD_CODE");

    state.mode = "client";
    game.setNetMode("client");
    // role finalization happens after init is received.
    game.setNetWaitForPeer(true);
    await connectWithMode(code, false);
  };

  render();
  return { host, join, reconnectHost, reconnectClient, disconnect, isPeerReady: () => peerReady };
}
