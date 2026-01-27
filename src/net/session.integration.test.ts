// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { initNetSession } from "./session";

class FakeGame {
  private role: any = null;
  setNetStatusLines(_lines: string[]): void {}
  setNetMode(_mode: any): void {}
  setRoleExternal(role: any): void { this.role = role; }
  getRoleExternal(): any { return this.role; }
  setNetWaitForPeer(_v: boolean): void {}
  setNetShootPulseHandler(_h: any): void {}

  getSerializedTrackDef(): string { return JSON.stringify({ points: [{ x: 0, y: 0 }, { x: 0, y: 10 }], baseWidthM: 7.5 }); }
  loadSerializedTrackDef(_def: string): boolean { return true; }

  // Host snapshot / client input plumbing (no-op for handshake test)
  getNetSnapshot(): any { return { t: 0, car: { xM: 0, yM: 0, headingRad: 0 } }; }
  applyNetSnapshot(_msg: any): void {}
  getAimWorld(): { x: number; y: number } { return { x: 0, y: 0 }; }
  getNavigatorShootHeld(): boolean { return false; }
  getCurrentWeaponIndex(): number { return 0; }
  getAndClearClientDamageEvents(): any[] { return []; }
  getClientProjectiles(): any[] { return []; }
  getInputStateExternal(): any { return {}; }
  applyRemoteNavigatorInput(_m: any): void {}
  applyRemoteDamageEvents(_events: any[]): void {}
  applyRemoteNavigatorProjectiles(_projectiles: any[]): void {}
  applyRemoteDriverInput(_input: any): void {}

  notify(_msg: string): void {}
}

type WsHandler = (ev: { data: string }) => void;

class FakeSignalServer {
  private rooms = new Map<string, Map<string, FakeWebSocket>>();

  connect(room: string, peer: string, create: boolean, ws: FakeWebSocket): void {
    const r = room.toUpperCase();
    const existing = this.rooms.get(r);

    if (create) {
      if (existing) {
        ws.deliver({ type: "error", code: "ROOM_TAKEN" });
        return;
      }
      const peers = new Map<string, FakeWebSocket>();
      peers.set(peer, ws);
      this.rooms.set(r, peers);
      ws.deliver({ type: "welcome", room: r, peer, peers: [] });
      return;
    }

    if (!existing) {
      ws.deliver({ type: "error", code: "ROOM_NOT_FOUND" });
      return;
    }

    existing.set(peer, ws);

    // Welcome the joiner with the existing peer list (excluding self).
    const otherPeers = [...existing.keys()].filter((p) => p !== peer);
    ws.deliver({ type: "welcome", room: r, peer, peers: otherPeers });

    // Notify existing peers.
    for (const [p, otherWs] of existing.entries()) {
      if (p === peer) continue;
      otherWs.deliver({ type: "peer-joined", peer });
    }
  }

  disconnect(room: string, peer: string): void {
    const r = room.toUpperCase();
    const existing = this.rooms.get(r);
    if (!existing) return;
    existing.delete(peer);
    for (const [, otherWs] of existing.entries()) {
      otherWs.deliver({ type: "peer-left", peer });
    }
    if (existing.size === 0) this.rooms.delete(r);
  }

  relay(room: string, from: string, to: string, payload: any): void {
    const r = room.toUpperCase();
    const existing = this.rooms.get(r);
    const ws = existing?.get(to);
    if (!ws) return;
    ws.deliver({ ...payload, from, to });
  }
}

const fakeSignalServer = new FakeSignalServer();

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  onopen: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onmessage: WsHandler | null = null;

  private pendingMessageEvents: { data: string }[] = [];

  private readonly room: string;
  private readonly peer: string;
  private readonly create: boolean;

  constructor(url: string) {
    this.url = url;

    // Buffer messages until the consumer attaches `onmessage`.
    let onmessageHandler: WsHandler | null = null;
    Object.defineProperty(this, "onmessage", {
      configurable: true,
      enumerable: true,
      get: () => onmessageHandler,
      set: (h: WsHandler | null) => {
        onmessageHandler = h;
        if (onmessageHandler && this.pendingMessageEvents.length > 0) {
          const pending = this.pendingMessageEvents;
          this.pendingMessageEvents = [];
          for (const ev of pending) {
            setTimeout(() => onmessageHandler?.(ev), 0);
          }
        }
      }
    });

    const u = new URL(url);
    this.room = u.searchParams.get("room") ?? "";
    this.peer = u.searchParams.get("peer") ?? "";
    this.create = u.searchParams.get("create") === "1";

    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      fakeSignalServer.connect(this.room, this.peer, this.create, this);
      this.onopen?.({});
    }, 0);
  }

  send(data: string): void {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice" || msg.type === "restart-ice") {
      const to = String(msg.to ?? "");
      fakeSignalServer.relay(this.room, this.peer, to, msg);
      return;
    }

    // ping/unknown: ignore
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    fakeSignalServer.disconnect(this.room, this.peer);
    this.onclose?.({});
  }

  deliver(obj: any): void {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    const data = JSON.stringify(obj);
    const handler = this.onmessage;
    if (!handler) {
      this.pendingMessageEvents.push({ data });
      return;
    }
    setTimeout(() => handler({ data }), 0);
  }
}

class FakeRTCDataChannel {
  readonly label: string;
  readyState: "connecting" | "open" | "closing" | "closed" = "connecting";

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  private peer: FakeRTCDataChannel | null = null;
  private openEventFired = false;
  private pendingIncoming: string[] = [];

  constructor(label: string) {
    this.label = label;

    // Buffer messages/open events until handlers are attached (prevents races).
    let onopenHandler: (() => void) | null = null;
    Object.defineProperty(this, "onopen", {
      configurable: true,
      enumerable: true,
      get: () => onopenHandler,
      set: (h: (() => void) | null) => {
        onopenHandler = h;
        if (onopenHandler && this.readyState === "open" && !this.openEventFired) {
          this.openEventFired = true;
          setTimeout(() => onopenHandler?.(), 0);
        }
      }
    });

    let onmessageHandler: ((ev: { data: string }) => void) | null = null;
    Object.defineProperty(this, "onmessage", {
      configurable: true,
      enumerable: true,
      get: () => onmessageHandler,
      set: (h: ((ev: { data: string }) => void) | null) => {
        onmessageHandler = h;
        if (onmessageHandler && this.pendingIncoming.length > 0) {
          const pending = this.pendingIncoming;
          this.pendingIncoming = [];
          for (const data of pending) {
            setTimeout(() => onmessageHandler?.({ data }), 0);
          }
        }
      }
    });
  }

  pairWith(other: FakeRTCDataChannel): void {
    this.peer = other;
  }

  open(): void {
    if (this.readyState === "open") return;
    this.readyState = "open";
    const handler = this.onopen;
    if (handler && !this.openEventFired) {
      this.openEventFired = true;
      setTimeout(() => handler(), 0);
    }
  }

  send(data: string): void {
    const p = this.peer;
    if (!p || p.readyState !== "open") return;
    const handler = p.onmessage;
    if (!handler) {
      p.pendingIncoming.push(data);
      return;
    }
    setTimeout(() => handler({ data }), 0);
  }

  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakeRTCPeerConnection {
  static pcs = new Map<string, FakeRTCPeerConnection>();
  static nextId = 1;

  readonly id: string;

  localDescription: any = null;
  remoteDescription: any = null;

  onicecandidate: ((ev: any) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: FakeRTCDataChannel }) => void) | null = null;

  iceConnectionState: "new" | "checking" | "connected" | "completed" | "failed" | "disconnected" | "closed" = "new";

  private outgoing: FakeRTCDataChannel | null = null;

  constructor(_cfg?: any) {
    this.id = `pc_${FakeRTCPeerConnection.nextId++}`;
    FakeRTCPeerConnection.pcs.set(this.id, this);
  }

  createDataChannel(label: string): FakeRTCDataChannel {
    const dc = new FakeRTCDataChannel(label);
    this.outgoing = dc;
    return dc;
  }

  async createOffer(_opts?: any): Promise<any> {
    return { type: "offer", sdp: JSON.stringify({ from: this.id }) };
  }

  async createAnswer(): Promise<any> {
    return { type: "answer", sdp: JSON.stringify({ from: this.id }) };
  }

  async setLocalDescription(desc: any): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(desc: any): Promise<void> {
    this.remoteDescription = desc;
    this.maybeConnectDataChannel();
  }

  async addIceCandidate(_cand: any): Promise<void> {}

  close(): void {
    this.iceConnectionState = "closed";
    this.oniceconnectionstatechange?.();
    FakeRTCPeerConnection.pcs.delete(this.id);
  }

  private maybeConnectDataChannel(): void {
    // Connect when either side receives the other side's description.
    // We encode the remote pc id in the SDP payload.
    const remoteId = (() => {
      try {
        const parsed = JSON.parse(String(this.remoteDescription?.sdp ?? ""));
        return typeof parsed?.from === "string" ? parsed.from : null;
      } catch {
        return null;
      }
    })();
    if (!remoteId) return;

    const remote = FakeRTCPeerConnection.pcs.get(remoteId);
    const remoteOutgoing = remote?.outgoing;
    if (!remote || !remoteOutgoing) return;

    // Already paired
    if ((remoteOutgoing as any)._paired) return;

    const incoming = new FakeRTCDataChannel(remoteOutgoing.label);
    (remoteOutgoing as any)._paired = true;

    remoteOutgoing.pairWith(incoming);
    incoming.pairWith(remoteOutgoing);

    // Deliver channel to the non-offerer.
    this.ondatachannel?.({ channel: incoming });

    setTimeout(() => {
      remoteOutgoing.open();
      incoming.open();
    }, 0);
  }
}

describe("multiplayer session (integration-ish)", () => {
  it("host and client reach READY over a fake signaling+webrtc stack", async () => {
    // Minimal DOM element used by session UI.
    const status = document.createElement("div");
    status.id = "net-status";
    document.body.appendChild(status);

    // Keep the document origin as-is (jsdom starts at about:blank), but provide
    // a signaling override so session code uses an absolute ws URL.
    window.history.pushState({}, "", "/?signalWs=ws://signal.test/ws");

    // Avoid network calls in tests.
    (globalThis as any).fetch = async () => ({ ok: true, text: async () => "ok", json: async () => ({ ok: true, iceServers: [] }) });

    (globalThis as any).WebSocket = FakeWebSocket;
    (globalThis as any).RTCPeerConnection = FakeRTCPeerConnection;

    const hostGame = new FakeGame();
    const clientGame = new FakeGame();

    const host = initNetSession(hostGame as any);
    const client = initNetSession(clientGame as any);

    const code = await host.host();
    await client.join(code);

    const waitFor = async (pred: () => boolean, ms: number): Promise<void> => {
      const start = Date.now();
      while (!pred()) {
        if (Date.now() - start > ms) throw new Error("timeout");
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    await waitFor(() => host.isPeerReady(), 500);
    await waitFor(() => client.isPeerReady(), 500);

    expect(host.isPeerReady()).toBe(true);
    expect(client.isPeerReady()).toBe(true);

    host.disconnect();
    client.disconnect();
  });
});
