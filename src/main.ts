import { Game } from "./runtime/game";
import { TuningPanel } from "./runtime/tuning";
import { initNetSession } from "./net/session";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing <canvas id=\"game\">");
}

const tuning = new TuningPanel(document.body);
const game = new Game(canvas, tuning);

// Server-infra testing: pairing + WebRTC handshake panel.
const net = initNetSession(game, {
  onPeerReady: () => {
    // Host: allow simulation once the shooter is actually in.
    game.setNetWaitForPeer(false);
  },
  onPeerDisconnected: () => {
    // If the shooter drops, pause again (host can re-invite).
    try {
      const url = new URL(window.location.href);
      const isHost = url.searchParams.get("host") === "1";
      const hasRoom = !!url.searchParams.get("room");
      if (hasRoom && isHost) game.setNetWaitForPeer(true);
    } catch {
      // ignore
    }
  }
});

const docAny = document as any;
const rootAny = document.documentElement as any;

const getFullscreenElement = (): Element | null => (document.fullscreenElement ?? docAny.webkitFullscreenElement ?? null);
const isFullscreen = (): boolean => !!getFullscreenElement();

const updateFullscreenUi = (): void => {
  if (!exitFsBtn) return;
  if (!looksTouch) {
    exitFsBtn.style.display = "none";
    return;
  }

  // Toggle button: show after START, and reflect current fullscreen state.
  exitFsBtn.textContent = isFullscreen() ? "X" : "FULL";
  exitFsBtn.style.display = document.body.classList.contains("started") ? "block" : "none";
};

const enterFullscreenLandscape = async (): Promise<void> => {
  try {
    if (!isFullscreen()) {
      if (rootAny.requestFullscreen) await rootAny.requestFullscreen();
      else if (rootAny.webkitRequestFullscreen) await rootAny.webkitRequestFullscreen();
    }
  } catch {
    // ignore
  }

  try {
    await (screen.orientation as any)?.lock?.("landscape");
  } catch {
    // ignore
  }

  try {
    window.scrollTo(0, 1);
  } catch {
    // ignore
  }
};

const exitFullscreen = async (): Promise<void> => {
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (docAny.webkitExitFullscreen) await docAny.webkitExitFullscreen();
  } catch {
    // ignore
  }
};

// If the user explicitly exits fullscreen, don't immediately force it back.
let wantsFullscreen = true;

const startMenu = document.getElementById("start-menu");
const startBtn = document.getElementById("btn-start") as HTMLButtonElement | null;
const inviteBtn = document.getElementById("btn-invite-menu") as HTMLButtonElement | null;
const netPanel = document.getElementById("net-panel") as HTMLDivElement | null;
const mobileOverlay = document.getElementById("mobile-overlay") as HTMLDivElement | null;
const exitFsBtn = document.getElementById("fullscreen-toggle") as HTMLButtonElement | null;
const startMenuSub = document.getElementById("start-menu-sub") as HTMLDivElement | null;

// Hide the old corner invite UI by default; we'll show it only in multiplayer.
if (netPanel) netPanel.style.display = "none";

// Ensure the touch overlay exists so the rotate-to-landscape prompt can show.
// Controls stay hidden until `.started` is set on <body>.
let looksTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
try {
  const url = new URL(window.location.href);
  if (url.searchParams.get("mobile") === "1" || url.searchParams.get("touch") === "1") looksTouch = true;
} catch {
  // ignore
}
if (looksTouch && mobileOverlay) mobileOverlay.style.display = "block";

const isLandscape = (): boolean => window.innerWidth > window.innerHeight;

const waitForLandscape = (timeoutMs: number): Promise<boolean> => {
  if (!looksTouch) return Promise.resolve(true);
  if (isLandscape()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      mql?.removeEventListener?.("change", onChange);
      window.clearTimeout(timer);
      resolve(ok);
    };

    const onChange = () => {
      if (isLandscape()) finish(true);
    };

    const mql = window.matchMedia?.("(orientation: landscape)") ?? null;
    mql?.addEventListener?.("change", onChange);
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);

    const timer = window.setTimeout(() => finish(isLandscape()), timeoutMs);
  });
};

const begin = (mode: "solo" | "multi", opts?: { fromUserGesture?: boolean }): void => {
  const fromUserGesture = opts?.fromUserGesture ?? true;

  wantsFullscreen = true;
  // User gesture path: unlock audio + fullscreen/landscape
  if (fromUserGesture) game.unlockAudioFromUserGesture();

  const url = new URL(window.location.href);
  const hasRoom = !!url.searchParams.get("room");

  // Shooter join links: skip the menu entirely (no gesture required).
  if (!fromUserGesture) {
    document.body.classList.add("started");
    if (startMenu) startMenu.style.display = "none";
    if (netPanel) netPanel.style.display = "block";
    if (looksTouch && mobileOverlay) mobileOverlay.style.display = "block";
  }

  if (mode === "multi") {
    // If we're not already joining via a link, create a host room + copy invite.
    if (!hasRoom) {
      try {
        net?.invite();
      } catch {
        // ignore
      }
    }
  }

  // Do not await (gesture-sensitive APIs like fullscreen/clipboard can be finicky across browsers).
  // Desktop: do not enter fullscreen at all.
  if (fromUserGesture && looksTouch && wantsFullscreen) void enterFullscreenLandscape();

  // If we're on touch and still portrait, wait until we're actually in landscape before starting.
  // This avoids first-frame camera/HUD calculations being based on portrait dimensions.
  if (looksTouch && !isLandscape()) {
    if (startMenuSub) startMenuSub.textContent = "Rotate to landscape to start.";
  } else {
    if (startMenuSub) startMenuSub.textContent = "Starting…";
  }

  void (async () => {
    const ok = fromUserGesture ? await waitForLandscape(1600) : true;
    if (!ok && looksTouch) {
      if (startMenuSub) startMenuSub.textContent = "Rotate to landscape to start.";
      return;
    }

    // Let layout settle after rotation/fullscreen.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    wantsFullscreen = true;
    document.body.classList.add("started");
    if (startMenu) startMenu.style.display = "none";
    if (netPanel) {
      // Show net status/controls only when multiplayer is in use.
      const nowUrl = new URL(window.location.href);
      const isInMultiplayer = !!nowUrl.searchParams.get("room");
      netPanel.style.display = isInMultiplayer ? "block" : "none";
    }
    if (looksTouch && mobileOverlay) mobileOverlay.style.display = "block";

    const startedUrl = new URL(window.location.href);
    const startedInMultiplayer = !!startedUrl.searchParams.get("room");
    const startedIsHost = startedUrl.searchParams.get("host") === "1";

    // Driver host: pause simulation until shooter is actually in.
    const alreadyReady = net?.isPeerReady?.() ?? false;
    game.setNetWaitForPeer(startedInMultiplayer && startedIsHost && !alreadyReady);

    // Start stage/track:
    // - Solo or Host: choose a random stage seed.
    // - Client (shooter join): wait for host to send trackDef.
    if (!startedInMultiplayer || startedIsHost) {
      game.pickRandomStartStage({ minSeed: 1, maxSeed: 1000 });
    }

    game.start();
    updateFullscreenUi();
  })();

  // Keep exit UI in sync (it will show once fullscreen is entered).
  updateFullscreenUi();
};

// If the user rotates after start, best-effort re-lock to landscape.
window.addEventListener("orientationchange", () => {
  if (!document.body.classList.contains("started")) return;
  if (!looksTouch) return;
  if (wantsFullscreen) void enterFullscreenLandscape();
});

startBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  begin("solo", { fromUserGesture: true });
});

inviteBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  begin("multi", { fromUserGesture: true });
});

exitFsBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  if (isFullscreen()) {
    wantsFullscreen = false;
    void exitFullscreen();
  } else {
    wantsFullscreen = true;
    void enterFullscreenLandscape();
  }
});

document.addEventListener("fullscreenchange", updateFullscreenUi);
document.addEventListener("webkitfullscreenchange", updateFullscreenUi as any);

// Desktop convenience: allow pressing Enter to start.
window.addEventListener("keydown", (e) => {
  if (document.body.classList.contains("started")) return;
  if (e.code === "Enter") {
    e.preventDefault();
    begin("solo", { fromUserGesture: true });
  }
});

// Shooter join links: bypass start menu and enter immediately.
try {
  const url = new URL(window.location.href);
  const room = url.searchParams.get("room");
  const isHost = url.searchParams.get("host") === "1";
  if (room && isHost) {
    // Host links should also skip the menu (use DISCONNECT to return to solo).
    begin("multi", { fromUserGesture: false });
  } else if (room && !isHost) {
    begin("multi", { fromUserGesture: false });
  }
} catch {
  // ignore
}
