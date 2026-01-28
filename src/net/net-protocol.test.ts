import { describe, expect, it } from "vitest";
import { parseDataChannelMessage } from "./net-protocol";

describe("net protocol (datachannel)", () => {
  it("returns null for invalid JSON", () => {
    expect(parseDataChannelMessage("{" as any)).toBeNull();
  });

  it("parses ready", () => {
    expect(parseDataChannelMessage(JSON.stringify({ type: "ready" }))?.type).toBe("ready");
  });

  it("parses init", () => {
    const msg = parseDataChannelMessage(JSON.stringify({ type: "init", trackDef: "{}", hostRole: "driver" }));
    expect(msg?.type).toBe("init");
    if (msg?.type === "init") {
      expect(msg.trackDef).toBe("{}");
      expect(msg.hostRole).toBe("driver");
    }
  });

  it("parses nav with optional bulletTimeHeld", () => {
    const msg = parseDataChannelMessage(
      JSON.stringify({ type: "nav", aimX: 1, aimY: 2, shootHeld: true, weaponIndex: 0, bulletTimeHeld: true })
    );
    expect(msg?.type).toBe("nav");
    if (msg?.type === "nav") {
      expect(msg.bulletTimeHeld).toBe(true);
    }
  });

  it("parses driver with input", () => {
    const msg = parseDataChannelMessage(
      JSON.stringify({ type: "driver", input: { steer: 0, throttle: 0, brake: 0, handbrake: 0, shoot: false } })
    );
    expect(msg?.type).toBe("driver");
  });

  it("rejects init with bad role", () => {
    expect(parseDataChannelMessage(JSON.stringify({ type: "init", trackDef: "{}", hostRole: "nope" }))).toBeNull();
  });

  it("parses permissive state snapshot", () => {
    const msg = parseDataChannelMessage(JSON.stringify({ type: "state", t: 1, car: { xM: 0 } }));
    expect(msg?.type).toBe("state");
  });
});
