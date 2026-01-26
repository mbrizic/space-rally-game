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

function randId(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function hostKeyStorageKey(room: string): string {
  return `space-rally-host-key:${room}`;
}

function loadStoredHostKey(room: string): string | null {
  try {
    return localStorage.getItem(hostKeyStorageKey(room));
  } catch {
    return null;
  }
}

function storeHostKey(room: string, key: string): void {
  try {
    localStorage.setItem(hostKeyStorageKey(room), key);
  } catch {
    // ignore
  }
}

function setQuery(params: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  history.replaceState({}, "", url.toString());
}

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

function wsUrl(room: string, peer: string): string {
  const u = new URL(resolveSignalWsEndpoint());
  u.searchParams.set("room", room);
  u.searchParams.set("peer", peer);
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
    onPeerReady?: () => void;
    onPeerDisconnected?: () => void;
  }
): { invite: () => void; isPeerReady: () => boolean } | null {
  const inviteBtn = document.getElementById("net-invite") as HTMLButtonElement | null;
  const roomInput = document.getElementById("net-room") as HTMLInputElement | null;
  const statusEl = document.getElementById("net-status") as HTMLDivElement | null;

  if (!inviteBtn || !roomInput || !statusEl) return null;

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
  let hostSendTimer: number | null = null;
  let clientSendTimer: number | null = null;
  let connectWatchdogTimer: number | null = null;
  let offerRestartCount = 0;
  let pendingIce: RTCIceCandidateInit[] = [];
  let shootPulse = false;
  let peerReady = false;

  const render = (): void => {
    const lines = [
      `mode: ${state.mode}`,
      `room: ${state.room || "-"}`,
      `ws: ${state.wsConnected ? "up" : "down"}`,
      `p2p: ${state.dcState}`,
      state.lastError ? `err: ${state.lastError}` : ""
    ].filter(Boolean);

    statusEl.textContent = lines.join("\n");
    game.setNetStatusLines(lines);

    // Update button appearance based on mode
    if (state.mode === "client") {
      // Hide button for clients
      inviteBtn.style.display = "none";
    } else if (state.mode === "host" && state.room) {
      // Show DISCONNECT for active host
      inviteBtn.style.display = "flex";
      inviteBtn.textContent = "DISCONNECT";
      inviteBtn.style.background = "#EF4444";
      inviteBtn.style.boxShadow = "0 4px 14px 0 rgba(239, 68, 68, 0.4)";
    } else if (state.mode === "host" && !state.room) {
      // Shouldn't happen, but fallback to INVITE
      inviteBtn.style.display = "flex";
      inviteBtn.textContent = "INVITE PLAYER";
      inviteBtn.style.background = "#3B82F6";
      inviteBtn.style.boxShadow = "0 4px 14px 0 rgba(59, 130, 246, 0.4)";
    } else {
      // Solo mode - show INVITE
      inviteBtn.style.display = "flex";
      inviteBtn.textContent = "INVITE PLAYER";
      inviteBtn.style.background = "#3B82F6";
      inviteBtn.style.boxShadow = "0 4px 14px 0 rgba(59, 130, 246, 0.4)";
    }
  };

  const setError = (msg: string | null): void => {
    state.lastError = msg;
    render();
  };

  const resetP2p = (): void => {
    if (hostSendTimer) window.clearInterval(hostSendTimer);
    if (clientSendTimer) window.clearInterval(clientSendTimer);
    if (connectWatchdogTimer) window.clearTimeout(connectWatchdogTimer);
    hostSendTimer = null;
    clientSendTimer = null;
    connectWatchdogTimer = null;
    offerRestartCount = 0;
    pendingIce = [];
    peerReady = false;
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

      if (connectWatchdogTimer) {
        window.clearTimeout(connectWatchdogTimer);
        connectWatchdogTimer = null;
      }

      if (state.mode === "host") {
        game.setNetMode("host");
        // Don't force role change - preserve user's current selection
        try {
          dc.send(JSON.stringify({ type: "init", trackDef: game.getSerializedTrackDef() }));
        } catch { }

        hostSendTimer = window.setInterval(() => {
          if (!dc || dc.readyState !== "open") return;
          try {
            dc.send(JSON.stringify({ type: "state", ...game.getNetSnapshot() }));
          } catch { }
        }, 33);

        opts?.onPeerConnected?.("host");
      }

      if (state.mode === "client") {
        game.setNetMode("client");
        const initialRole = new URL(window.location.href).searchParams.get("role") === "driver" ? PlayerRole.DRIVER : PlayerRole.NAVIGATOR;
        game.setRoleExternal(initialRole);
        game.setNetShootPulseHandler(() => { shootPulse = true; });

        // Tell the host we're actually in-game (so host can start sim).
        try {
          dc.send(JSON.stringify({ type: "ready" }));
        } catch { }

        clientSendTimer = window.setInterval(() => {
          if (!dc || dc.readyState !== "open") return;

          if (game.getRoleExternal() === PlayerRole.NAVIGATOR) {
            const aim = game.getAimWorld();
            const payload = {
              type: "nav",
              aimX: aim.x,
              aimY: aim.y,
              shootHeld: game.getNavigatorShootHeld(),
              shootPulse,
              weaponIndex: game.getCurrentWeaponIndex()
            };
            shootPulse = false;
            try { dc.send(JSON.stringify(payload)); } catch { }
          } else if (game.getRoleExternal() === PlayerRole.DRIVER) {
            const payload = {
              type: "driver",
              input: game.getInputStateExternal()
            };
            try { dc.send(JSON.stringify(payload)); } catch { }
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

      if (msg?.type === "ready" && state.mode === "host") {
        peerReady = true;
        opts?.onPeerReady?.();
        return;
      }

      if (msg?.type === "init" && state.mode === "client") {
        const ok = typeof msg.trackDef === "string" ? game.loadSerializedTrackDef(msg.trackDef) : false;
        if (!ok) setError("bad trackDef");
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
          shootPulse: !!msg.shootPulse,
          weaponIndex: typeof msg.weaponIndex === "number" ? msg.weaponIndex : 0
        });
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

  const connect = (room: string): void => {
    const cleanRoom = room.trim().toUpperCase();
    if (!cleanRoom) return;

    setError(null);
    state.room = cleanRoom;
    state.remotePeer = null;
    resetP2p();

    if (!state.peer) state.peer = `p_${Math.random().toString(36).slice(2, 10)}`;

    if (ws) {
      try { ws.close(); } catch { }
      ws = null;
    }

    const url = wsUrl(state.room, state.peer);
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
      pingTimer = window.setInterval(() => {
        try { ws?.send(JSON.stringify({ type: "ping", t: Date.now() })); } catch { }
      }, 10_000);
    };

    ws.onclose = (_e) => {
      state.wsConnected = false;
      render();
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = null;
      resetP2p();
    };

    ws.onerror = () => setError("ws error");

    ws.onmessage = async (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }

      if (msg.type === "welcome") {
        const peers = (msg as WelcomeMsg).peers ?? [];
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
  };

  const startRoom = (room: string, asHost: boolean = false): void => {
    const cleanRoom = room.trim().toUpperCase();
    roomInput.value = cleanRoom;
    if (asHost) {
      const key = randId(10);
      storeHostKey(cleanRoom, key);
      setQuery({ room: cleanRoom, host: "1", hostKey: key });

      // Immediately enter host mode and show the waiting HUD.
      // Previously we only flipped to host once the RTC datachannel opened,
      // which meant the WAITING banner could fail to appear right after inviting.
      game.setNetMode("host");
      game.setNetWaitForPeer(true);
    } else {
      setQuery({ room: cleanRoom });
    }
    connect(cleanRoom);
  };

  const copyToClipboard = async () => {
    const url = new URL(window.location.href);
    if (state.room) url.searchParams.set("room", state.room);

    // Include hostKey in invite URL so joiner can validate the session.
    // The joiner will NOT become host (host=1 is removed) but they carry the key
    // to prove they received a legitimate invite from the host.
    const storedKey = loadStoredHostKey(state.room);
    if (storedKey) url.searchParams.set("hostKey", storedKey);

    // Ensure copied URL is always a *joiner* link (never a host link).
    // Preserve other params like signaling overrides.
    url.searchParams.delete("host");
    const role = url.searchParams.get("role");
    if (role === "driver") url.searchParams.delete("role");
    try {
      await navigator.clipboard.writeText(url.toString());
      const oldText = inviteBtn.textContent;
      inviteBtn.textContent = "COPIED!";
      window.setTimeout(() => {
        inviteBtn.textContent = oldText;
      }, 1000);
    } catch {
      setError("copy failed");
    }
  };

  const doInvite = () => {
    if (state.mode === "host" && state.room) {
      // Disconnect and return to solo
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      url.searchParams.delete("host");
      url.searchParams.delete("role");
      window.location.href = url.toString();
    } else {
      // Create new room and copy link
      state.mode = "host";
      const roomCode = randId(4);
      startRoom(roomCode, true);
      copyToClipboard();
    }
  };

  inviteBtn.addEventListener("click", () => {
    doInvite();
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startRoom(roomInput.value);
  });

  // Auto-join/host based on URL parameters
  const url = new URL(window.location.href);
  const initialRoom = url.searchParams.get("room");
  const requestedHost = url.searchParams.get("host") === "1";
  const urlHostKey = url.searchParams.get("hostKey");

  if (initialRoom) {
    const room = initialRoom.trim().toUpperCase();
    const storedHostKey = loadStoredHostKey(room);
    const isHost = requestedHost && !!storedHostKey && !!urlHostKey && storedHostKey === urlHostKey;

    if (requestedHost && !isHost) {
      // Someone tried to force host=1 without owning the room. Downgrade to client.
      setQuery({ host: null, hostKey: null });
    }

    if (isHost) state.mode = "host";
    else state.mode = "client";
    startRoom(room, isHost);
  } else {
    render();
  }

  return { invite: doInvite, isPeerReady: () => peerReady };
}
