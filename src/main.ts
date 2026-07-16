import "./styles/main.css";
import { GameApp } from "./app/GameApp";

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

if (!canvas || !uiRoot) {
  throw new Error("游戏挂载节点缺失");
}

const app = new GameApp(canvas, uiRoot);
void app.initialize();

window.addEventListener("beforeunload", () => app.dispose());
