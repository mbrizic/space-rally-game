import { Game } from "./runtime/game";
import { TuningPanel } from "./runtime/tuning";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing <canvas id=\"game\">");
}

const tuning = new TuningPanel(document.body);
const game = new Game(canvas, tuning);
game.start();
