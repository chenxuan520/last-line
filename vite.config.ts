import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { defineConfig } from "vite";
import { singlePlayerDebugEnabledForVite } from "./src/config/debug";

const appVersion = env.APP_VERSION?.trim() || gitVersion();

export default defineConfig(({ command }) => {
  const singlePlayerDebug = singlePlayerDebugEnabledForVite(command, env.VITE_SINGLE_PLAYER_DEBUG);
  return {
    base: "./",
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __SINGLE_PLAYER_DEBUG__: JSON.stringify(singlePlayerDebug),
    },
    server: {
      host: "127.0.0.1",
    },
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{
              name: "ultra-shadow-shaders",
              test: /[\\/]Shaders(?:WGSL)?[\\/](?:ShadersInclude[\\/])?(?:shadowMap|depthBoxBlur|kernelBlur|packingFunctions|sceneVertexDeclaration|instancesDeclaration)/,
              includeDependenciesRecursively: false,
            }, {
              name: "ultra-post-shaders",
              test: /[\\/]Shaders(?:WGSL)?[\\/](?:ssao2|ssaoCombine|bloomMerge|extractHighlights|imageProcessing|pass|passCube)\.fragment\.js$/,
              includeDependenciesRecursively: false,
            }],
          },
        },
      },
    },
  };
});

function gitVersion(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--always"], { encoding: "utf8" }).trim() || "dev";
  } catch {
    return "dev";
  }
}
