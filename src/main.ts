import { Game } from "./runtime/game";
import { TuningPanel } from "./runtime/tuning";
import { initNetSession } from "./net/session";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing <canvas id=\"game\">");
}

const tuning = new TuningPanel(document.body);
const game = new Game(canvas, tuning);

let pendingMultiplayerStart:
  | null
  | {
      mode: "host" | "client";
      started: boolean;
    } = null;

const net = initNetSession(game, {
  onPeerReady: (mode) => {
    // Multiplayer should only start rendering once both peers are actually in.
    if (!pendingMultiplayerStart) pendingMultiplayerStart = { mode, started: false };
    if (pendingMultiplayerStart.started) return;
    pendingMultiplayerStart.started = true;
    void finalizeStart({ multiplayer: true });
  },
  onPeerDisconnected: () => {
    // If someone drops, stop simulation and return to lobby.
    if (document.body.classList.contains("started")) {
      document.body.classList.remove("started");
      if (startMenu) startMenu.style.display = "flex";
    }
    try { game.stop(); } catch { }
    game.setNetWaitForPeer(true);
  }
});

// Vite dev (HMR) can re-run this module without a full reload, which can leave
// multiple RAF loops and duplicated listeners running (feels "twitchy").
// Force a hard reload on hot updates.
try {
  const hot: any = (import.meta as any).hot;
  hot?.dispose?.(() => {
    try { net.disconnect(); } catch { }
    try { game.stop(); } catch { }
    window.location.reload();
  });
} catch {
  // ignore
}

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
const hostDriverBtn = document.getElementById("btn-host-driver") as HTMLButtonElement | null;
const joinCtaBtn = document.getElementById("btn-join-codriver") as HTMLButtonElement | null;
const joinConfirmBtn = document.getElementById("btn-join-confirm") as HTMLButtonElement | null;
const joinBackBtn = document.getElementById("btn-join-back") as HTMLButtonElement | null;
const joinCodeInput = document.getElementById("mp-join-code") as HTMLInputElement | null;
const joinCtaRow = document.getElementById("mp-join-cta") as HTMLDivElement | null;
const joinForm = document.getElementById("mp-join-form") as HTMLDivElement | null;
const hostBox = document.getElementById("mp-host") as HTMLDivElement | null;
const hostCodeEl = document.getElementById("mp-code") as HTMLDivElement | null;
const mpErrorEl = document.getElementById("mp-error") as HTMLDivElement | null;
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

const setMpError = (msg: string | null): void => {
  if (!mpErrorEl) return;
  mpErrorEl.textContent = msg ?? "";
};

const setJoinUi = (mode: "collapsed" | "expanded"): void => {
  if (joinCtaRow) joinCtaRow.style.display = mode === "collapsed" ? "flex" : "none";
  if (joinForm) joinForm.style.display = mode === "expanded" ? "block" : "none";
  if (mode === "expanded") {
    window.setTimeout(() => {
      try { joinCodeInput?.focus(); } catch { }
    }, 0);
  }
};

const finalizeStart = async (opts?: { multiplayer?: boolean }): Promise<void> => {
  // Wait for touch devices to settle into landscape before first frame.
  if (looksTouch && !isLandscape()) {
    if (startMenuSub) startMenuSub.textContent = "Rotate to landscape to start.";
  } else {
    if (startMenuSub) startMenuSub.textContent = "Starting…";
  }

  const ok = await waitForLandscape(1600);
  if (!ok && looksTouch) {
    if (startMenuSub) startMenuSub.textContent = "Rotate to landscape to start.";
    return;
  }

  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  wantsFullscreen = true;
  document.body.classList.add("started");
  if (startMenu) startMenu.style.display = "none";
  if (looksTouch && mobileOverlay) mobileOverlay.style.display = "block";

  if (!opts?.multiplayer) {
    game.pickRandomStartStage({ minSeed: 1, maxSeed: 1000 });
  }

  game.setNetWaitForPeer(false);
  game.start();
  updateFullscreenUi();
};

const beginSolo = (): void => {
  setMpError(null);
  pendingMultiplayerStart = null;
  setJoinUi("collapsed");
  game.unlockAudioFromUserGesture();
  if (looksTouch && wantsFullscreen) void enterFullscreenLandscape();
  void finalizeStart({ multiplayer: false });
};

const beginHost = async (): Promise<void> => {
  setMpError(null);
  pendingMultiplayerStart = { mode: "host", started: false };

  if (hostBox) hostBox.style.display = "none";
  setJoinUi("collapsed");

  game.unlockAudioFromUserGesture();
  if (looksTouch && wantsFullscreen) void enterFullscreenLandscape();

  // Host picks the stage up-front so the init message has a deterministic trackDef.
  game.pickRandomStartStage({ minSeed: 1, maxSeed: 1000 });
  game.setNetWaitForPeer(true);

  if (startMenuSub) startMenuSub.textContent = "Creating room…";
  try {
    const code = await net.host();
    if (hostBox) hostBox.style.display = "block";
    if (hostCodeEl) hostCodeEl.textContent = code;
    if (startMenuSub) startMenuSub.textContent = "Waiting for gunner to join…";
  } catch (e: any) {
    setMpError("Failed to create room.");
    if (startMenuSub) startMenuSub.textContent = "";
  }
};

const beginJoin = async (): Promise<void> => {
  setMpError(null);
  pendingMultiplayerStart = { mode: "client", started: false };

  if (hostBox) hostBox.style.display = "none";
  setJoinUi("expanded");

  game.unlockAudioFromUserGesture();
  if (looksTouch && wantsFullscreen) void enterFullscreenLandscape();

  const code = (joinCodeInput?.value ?? "").trim();
  if (!/^\d{4}$/.test(code.replace(/\D/g, ""))) {
    setMpError("Enter a 4-digit code.");
    return;
  }

  if (startMenuSub) startMenuSub.textContent = "Joining room…";
  game.setNetWaitForPeer(true);

  try {
    await net.join(code);
    if (startMenuSub) startMenuSub.textContent = "Connected. Waiting for host…";
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg === "ROOM_NOT_FOUND") setMpError("Room not found. Check the code.");
    else if (msg === "BAD_CODE") setMpError("Enter a 4-digit code.");
    else setMpError("Failed to join room.");
    if (startMenuSub) startMenuSub.textContent = "";
  }
};

// If the user rotates after start, best-effort re-lock to landscape.
window.addEventListener("orientationchange", () => {
  if (!document.body.classList.contains("started")) return;
  if (!looksTouch) return;
  if (wantsFullscreen) void enterFullscreenLandscape();
});

startBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  beginSolo();
});

hostDriverBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  void beginHost();
});

joinCtaBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  setMpError(null);
  setJoinUi("expanded");
});

joinBackBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  setMpError(null);
  setJoinUi("collapsed");
});

joinConfirmBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  void beginJoin();
});

joinCodeInput?.addEventListener("input", () => {
  if (!joinCodeInput) return;
  joinCodeInput.value = joinCodeInput.value.replace(/\D/g, "").slice(0, 4);
});

joinCodeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void beginJoin();
  }
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
    beginSolo();
  }
});

// URL-based join links removed (use 4-digit code instead).
