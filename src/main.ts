import { Game } from "./runtime/game";

const canvas = document.getElementById("game");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing <canvas id=\"game\">");
}

const game = new Game(canvas);
game.start();

