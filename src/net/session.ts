type NetState = {
  room: string;
  peer: string;
  remotePeer: string | null;
  wsConnected: boolean;
  dcState: string;
  lastError: string | null;
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
type ErrorMsg = { type: "error"; code: string; to?: string };

type ServerMsg = WelcomeMsg | PeerEventMsg | OfferMsg | AnswerMsg | IceMsg | ErrorMsg | { type: string; [k: string]: unknown };

function randId(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

function setQuery(params: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  history.replaceState({}, "", url.toString());
}

function wsUrl(room: string, peer: string): string {
  const u = new URL("/api/ws", window.location.origin);
  u.searchParams.set("room", room);
  u.searchParams.set("peer", peer);
  return u.toString().replace(/^http/, "ws");
}

export function initNetSession(): void {
  const roomInput = document.getElementById("net-room") as HTMLInputElement | null;
  const createBtn = document.getElementById("net-create") as HTMLButtonElement | null;
  const joinBtn = document.getElementById("net-join") as HTMLButtonElement | null;
  const copyBtn = document.getElementById("net-copy") as HTMLButtonElement | null;
  const statusEl = document.getElementById("net-status") as HTMLDivElement | null;
  if (!roomInput || !createBtn || !joinBtn || !copyBtn || !statusEl) return;

  const state: NetState = {
    room: "",
    peer: "",
    remotePeer: null,
    wsConnected: false,
    dcState: "closed",
    lastError: null
  };

  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let pingTimer: number | null = null;
  let wsLastClose: string | null = null;
  let wsLastUrl: string | null = null;

  const render = (): void => {
    const lines = [
      `room: ${state.room || "-"}`,
      `peer: ${state.peer || "-"}`,
      `remote: ${state.remotePeer || "-"}`,
      `ws: ${state.wsConnected ? "up" : "down"}`,
      wsLastUrl ? `wsUrl: ${wsLastUrl}` : "",
      wsLastClose ? `wsClose: ${wsLastClose}` : "",
      `p2p: ${state.dcState}`,
      state.lastError ? `err: ${state.lastError}` : ""
    ].filter(Boolean);
    statusEl.textContent = lines.join("\n");
  };

  const setError = (msg: string | null): void => {
    state.lastError = msg;
    render();
  };

  const resetP2p = (): void => {
    try {
      dc?.close();
    } catch {
      // ignore
    }
    try {
      pc?.close();
    } catch {
      // ignore
    }
    dc = null;
    pc = null;
    state.dcState = "closed";
    render();
  };

  const ensurePc = (remotePeer: string): RTCPeerConnection => {
    if (pc) return pc;
    const iceServers: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
    pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
      if (!e.candidate || !ws || ws.readyState !== WebSocket.OPEN || !state.remotePeer) return;
      ws.send(JSON.stringify({ type: "ice", to: state.remotePeer, candidate: e.candidate.toJSON() }));
    };

    pc.onconnectionstatechange = () => {
      // datachannel open/close is the real signal for our use, but this is useful for debugging.
      render();
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
      try {
        dc?.send(JSON.stringify({ type: "hello", peer: state.peer }));
      } catch {
        // ignore
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
    dc.onmessage = () => {
      // Intentionally no-op for now (handshake testing only).
    };
  };

  const maybeStartOffer = async (): Promise<void> => {
    if (!state.remotePeer) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // Deterministic offerer: lexicographically smaller peer id.
    const isOfferer = state.peer < state.remotePeer;
    if (!isOfferer) return;

    const pc0 = ensurePc(state.remotePeer);
    if (!dc) {
      dc = pc0.createDataChannel("data", { ordered: false, maxRetransmits: 0 });
      wireDc();
    }

    try {
      const offer = await pc0.createOffer();
      await pc0.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", to: state.remotePeer, sdp: offer }));
    } catch (e) {
      setError(`offer failed`);
      console.error(e);
    }
  };

  const connect = (room: string): void => {
    const cleanRoom = room.trim().toUpperCase();
    if (!cleanRoom) return;

    setError(null);
    wsLastClose = null;
    state.room = cleanRoom;
    state.remotePeer = null;
    resetP2p();

    if (!state.peer) state.peer = `p_${Math.random().toString(36).slice(2, 10)}`;

    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }

    const url = wsUrl(state.room, state.peer);
    wsLastUrl = url;
    ws = new WebSocket(url);

    // Quick connectivity hint (useful when nginx proxy isn't wired yet).
    fetch("/api/health")
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then(() => {
        // ok
      })
      .catch(() => {
        setError("no /api/health (nginx proxy?)");
      });

    ws.onopen = () => {
      state.wsConnected = true;
      setError(null);
      render();
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        try {
          ws?.send(JSON.stringify({ type: "ping", t: Date.now() }));
        } catch {
          // ignore
        }
      }, 10_000);
    };

    ws.onclose = (e) => {
      state.wsConnected = false;
      wsLastClose = `${e.code}${e.reason ? ` ${e.reason}` : ""}`;
      render();
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = null;
      resetP2p();
    };

    ws.onerror = () => {
      setError("ws error");
    };

    ws.onmessage = async (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }

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

        const pc0 = ensurePc(m.from);
        try {
          await pc0.setRemoteDescription(m.sdp);
          const answer = await pc0.createAnswer();
          await pc0.setLocalDescription(answer);
          ws?.send(JSON.stringify({ type: "answer", to: m.from, sdp: answer }));
        } catch (e) {
          setError("answer failed");
          console.error(e);
        }
        return;
      }

      if (msg.type === "answer") {
        const m = msg as AnswerMsg;
        if (m.to !== state.peer) return;
        const pc0 = ensurePc(m.from);
        try {
          await pc0.setRemoteDescription(m.sdp);
        } catch (e) {
          setError("setRemoteDescription failed");
          console.error(e);
        }
        return;
      }

      if (msg.type === "ice") {
        const m = msg as IceMsg;
        if (m.to !== state.peer) return;
        const pc0 = ensurePc(m.from);
        try {
          await pc0.addIceCandidate(m.candidate);
        } catch {
          // ignore (can happen during restart)
        }
        return;
      }

      if (msg.type === "error") {
        const m = msg as ErrorMsg;
        setError(m.code);
      }
    };

    render();
  };

  const startRoom = (room: string): void => {
    const cleanRoom = room.trim().toUpperCase();
    roomInput.value = cleanRoom;
    setQuery({ room: cleanRoom });
    connect(cleanRoom);
  };

  createBtn.addEventListener("click", () => startRoom(randId(4)));
  joinBtn.addEventListener("click", () => startRoom(roomInput.value));
  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startRoom(roomInput.value);
  });

  copyBtn.addEventListener("click", async () => {
    const url = new URL(window.location.href);
    if (state.room) url.searchParams.set("room", state.room);
    try {
      await navigator.clipboard.writeText(url.toString());
      setError("copied");
      window.setTimeout(() => setError(null), 800);
    } catch {
      // ignore
    }
  });

  // Auto-join if URL has a room.
  const initialRoom = new URL(window.location.href).searchParams.get("room");
  if (initialRoom) startRoom(initialRoom);
  else render();
}
