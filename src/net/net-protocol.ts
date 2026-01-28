import type { InputState } from "../runtime/input";

export type NetRole = "driver" | "navigator";

export type WelcomeMsg = {
  type: "welcome";
  room: string;
  peer: string;
  peers: string[];
};

export type PeerEventMsg =
  | { type: "peer-joined"; peer: string }
  | { type: "peer-left"; peer: string };

export type OfferMsg = { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit };
export type AnswerMsg = { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit };
export type IceMsg = { type: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };
export type RestartIceMsg = { type: "restart-ice"; from: string; to: string; reason?: string };
export type ErrorMsg = { type: "error"; code: string; to?: string };

export type ServerMsg =
  | WelcomeMsg
  | PeerEventMsg
  | OfferMsg
  | AnswerMsg
  | IceMsg
  | RestartIceMsg
  | ErrorMsg
  | { type: string; [k: string]: unknown };

export type DcReadyMsg = { type: "ready" };
export type DcInitMsg = { type: "init"; trackDef: string; hostRole: NetRole };
export type DcTrackMsg = { type: "track"; trackDef: string };

// Host -> client snapshot. We keep this permissive because the snapshot shape evolves.
export type DcStateMsg = { type: "state"; t: number; car: unknown } & Record<string, unknown>;

export type DcNavMsg = {
  type: "nav";
  aimX: number;
  aimY: number;
  shootHeld: boolean;
  weaponIndex: number;
  bulletTimeHeld?: boolean;
  damageEvents?: unknown;
  projectiles?: unknown;
};

export type DcDriverMsg = {
  type: "driver";
  input: InputState;
  bulletTimeHeld?: boolean;
};

export type DcMessage = DcReadyMsg | DcInitMsg | DcTrackMsg | DcStateMsg | DcNavMsg | DcDriverMsg;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNetRole(v: unknown): v is NetRole {
  return v === "driver" || v === "navigator";
}

export function parseDataChannelMessage(data: string): DcMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isObject(parsed) || !isString(parsed.type)) return null;
  const type = parsed.type;

  if (type === "ready") {
    return { type: "ready" };
  }

  if (type === "init") {
    if (!isString(parsed.trackDef) || !isNetRole(parsed.hostRole)) return null;
    return { type: "init", trackDef: parsed.trackDef, hostRole: parsed.hostRole };
  }

  if (type === "track") {
    if (!isString(parsed.trackDef)) return null;
    return { type: "track", trackDef: parsed.trackDef };
  }

  if (type === "state") {
    if (!isNumber(parsed.t) || !("car" in parsed)) return null;
    // Preserve any extra fields without re-validating.
    return parsed as DcStateMsg;
  }

  if (type === "nav") {
    if (!isNumber(parsed.aimX) || !isNumber(parsed.aimY) || !isBoolean(parsed.shootHeld) || !isNumber(parsed.weaponIndex)) return null;
    if ("bulletTimeHeld" in parsed && parsed.bulletTimeHeld !== undefined && !isBoolean(parsed.bulletTimeHeld)) return null;
    return parsed as DcNavMsg;
  }

  if (type === "driver") {
    if (!isObject(parsed.input)) return null;
    if ("bulletTimeHeld" in parsed && parsed.bulletTimeHeld !== undefined && !isBoolean(parsed.bulletTimeHeld)) return null;
    return parsed as DcDriverMsg;
  }

  return null;
}
