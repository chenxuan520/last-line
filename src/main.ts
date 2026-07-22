import "./styles/main.css";
import { GameApp } from "./app/GameApp";
import { installDynamicChunkRecovery } from "./client/dynamicChunkRecovery";

const disposeChunkRecovery = installDynamicChunkRecovery({
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  sessionStorage,
  reload: () => window.location.reload(),
});

const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

if (!canvas || !uiRoot) {
  throw new Error("游戏挂载节点缺失");
}

const app = new GameApp(canvas, uiRoot);
void app.initialize();

window.addEventListener("beforeunload", () => {
  disposeChunkRecovery();
  app.dispose();
});
