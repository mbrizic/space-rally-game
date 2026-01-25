import { Game } from "./runtime/game";
import { TuningPanel } from "./runtime/tuning";
import { initNetSession } from "./net/session";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing <canvas id=\"game\">");
}

const tuning = new TuningPanel(document.body);
const game = new Game(canvas, tuning);
game.start();

// Server-infra testing: pairing + WebRTC handshake panel.
initNetSession();
