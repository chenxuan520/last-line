import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import WebSocket from "ws";

interface Arguments {
  repository: string;
  mapId: "island" | "town" | "mixed";
  seed: number;
  quality: "low" | "medium" | "high";
}

function parseArguments(): Arguments {
  const values = new Map<string, string>();
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index];
    const value = process.argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${name ?? ""}`);
    values.set(name.slice(2), value);
  }
  const repository = values.get("repository");
  const mapId = values.get("map") as Arguments["mapId"] | undefined;
  const quality = values.get("quality") as Arguments["quality"] | undefined;
  const seed = Number(values.get("seed"));
  if (!repository || !mapId || !["island", "town", "mixed"].includes(mapId)) {
    throw new Error("Expected --repository and --map island|town|mixed");
  }
  if (!quality || !["low", "medium", "high"].includes(quality)) {
    throw new Error("Expected --quality low|medium|high");
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error("Expected --seed uint32");
  }
  return { repository, mapId, seed, quality };
}

function mimeType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

async function startServer(repository: string): Promise<{ server: Server; url: string }> {
  const root = path.resolve(repository, "dist");
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      let filePath = path.resolve(root, relativePath);
      if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== path.join(root, "index.html")) {
        response.writeHead(403).end();
        return;
      }
      try {
        if (!(await stat(filePath)).isFile()) throw new Error("not file");
      } catch {
        filePath = path.join(root, "index.html");
      }
      response.writeHead(200, {
        "content-type": mimeType(filePath),
        "cache-control": "no-store",
      });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Performance server address missing");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function waitForFile(filePath: string, timeoutMilliseconds: number): Promise<string> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function chromeExecutable(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  return process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome";
}

async function stopChrome(chrome: ChildProcess | null): Promise<void> {
  if (!chrome || chrome.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
  chrome.kill("SIGTERM");
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (stopped || chrome.exitCode !== null) return;
  chrome.kill("SIGKILL");
  await exited;
}

class CdpClient {
  private sequence = 0;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();

  public constructor(private readonly socket: WebSocket) {
    socket.on("message", (payload) => {
      const message = JSON.parse(payload.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message ?? "CDP error"));
      else request.resolve(message.result);
    });
  }

  public async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.sequence;
    const response = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return response;
  }
}

async function connectPage(browserPort: number, url: string): Promise<{ socket: WebSocket; client: CdpClient }> {
  const response = await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  if (!response.ok) throw new Error(`Unable to create Chrome target: ${response.status}`);
  const target = await response.json() as { webSocketDebuggerUrl?: string };
  if (!target.webSocketDebuggerUrl) throw new Error("Chrome target WebSocket missing");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  const client = new CdpClient(socket);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Performance.enable");
  await client.send("HeapProfiler.enable");
  await client.send("Page.navigate", { url });
  return { socket, client };
}

async function evaluate<T>(client: CdpClient, expression: string): Promise<T> {
  const response = await client.send<{
    result?: { value?: T };
    exceptionDetails?: { text?: string };
  }>("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "Browser evaluation failed");
  return response.result?.value as T;
}

async function waitFor<T>(
  client: CdpClient,
  expression: string,
  predicate: (value: T) => boolean,
  timeoutMilliseconds: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = await evaluate<T>(client, expression);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
}

async function main(): Promise<void> {
  const { repository, mapId, seed, quality } = parseArguments();
  const { server, url } = await startServer(repository);
  const profileDirectory = await mkdtemp(path.join(tmpdir(), "last-line-performance-chrome-"));
  let chrome: ChildProcess | null = null;
  let socket: WebSocket | null = null;
  try {
    chrome = spawn(chromeExecutable(), [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1280,720",
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let chromeError = "";
    chrome.stderr?.on("data", (chunk) => { chromeError += chunk.toString(); });
    chrome.once("exit", (code) => {
      if (code && code !== 0) console.error(`Chrome exited ${code}: ${chromeError}`);
    });
    const portSource = await waitForFile(path.join(profileDirectory, "DevToolsActivePort"), 15_000);
    const browserPort = Number(portSource.split(/\r?\n/, 1)[0]);
    if (!Number.isInteger(browserPort)) throw new Error("Chrome debugging port missing");
    const page = await connectPage(browserPort, url);
    socket = page.socket;
    const client = page.client;
    await waitFor(client, "document.readyState", (value) => value === "complete", 30_000);
    await evaluate(client, `(() => {
      localStorage.setItem("last-line.settings.v1", JSON.stringify({
        mapId: ${JSON.stringify(mapId)},
        quality: ${JSON.stringify(quality)},
        volume: 0,
        sensitivity: 1,
        startWithBandage: true,
        disableAiSnipers: true,
        showGroundLootModels: true
      }));
    })()`);
    const performanceUrl = `${url}?performance-sample=${Date.now()}`;
    await client.send("Page.navigate", { url: performanceUrl });
    await waitFor(
      client,
      `document.readyState === "complete" &&
        location.search.includes("performance-sample") &&
        Boolean(document.querySelector('[data-action="start"]'))`,
      Boolean,
      30_000,
    );
    await evaluate(client, `(() => {
      let first = true;
      let value = (${seed} ^ 0x9e3779b9) >>> 0;
      Math.random = () => {
        if (first) {
          first = false;
          return ${seed} / 4294967296;
        }
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
      };
      window.__runtimePerformance = {
        clickStarted: performance.now(),
        frames: [],
        hudAt: null
      };
      const frame = (timestamp) => {
        window.__runtimePerformance.frames.push(timestamp);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      document.querySelector('[data-action="start"]').click();
    })()`);
    const hudAt = await waitFor<number | null>(
      client,
      `(() => {
        if (document.querySelector('[data-hud="performance"]')) {
          window.__runtimePerformance.hudAt ??= performance.now();
        }
        return window.__runtimePerformance.hudAt;
      })()`,
      (value) => typeof value === "number",
      60_000,
    );
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    const browser = await evaluate<{
      clickStarted: number;
      hudAt: number;
      frames: number[];
      fpsText: string;
    }>(client, `({
      clickStarted: window.__runtimePerformance.clickStarted,
      hudAt: window.__runtimePerformance.hudAt,
      frames: window.__runtimePerformance.frames,
      fpsText: document.querySelector('[data-hud="performance"]')?.textContent ?? ""
    })`);
    await client.send("HeapProfiler.collectGarbage");
    const metrics = await client.send<{
      metrics: Array<{ name: string; value: number }>;
    }>("Performance.getMetrics");
    const metric = (name: string): number =>
      metrics.metrics.find((entry) => entry.name === name)?.value ?? 0;
    const stableStart = hudAt + 2_000;
    const startupFrames = browser.frames.filter((timestamp) =>
      timestamp >= browser.clickStarted && timestamp < stableStart
    );
    const stableFrames = browser.frames.filter((timestamp) => timestamp >= stableStart);
    const frameDeltas = (frames: readonly number[]): number[] =>
      frames.slice(1).map((timestamp, index) =>
        timestamp - (frames[index] ?? timestamp)
      ).filter((delta) => delta > 0 && delta < 2_000);
    const startupFrameDeltas = frameDeltas(startupFrames);
    const stableFrameDeltas = frameDeltas(stableFrames);
    const meanFrameMilliseconds = stableFrameDeltas.length > 0
      ? stableFrameDeltas.reduce((total, delta) => total + delta, 0) / stableFrameDeltas.length
      : 0;
    const startupMeanFrameMilliseconds = startupFrameDeltas.length > 0
      ? startupFrameDeltas.reduce((total, delta) => total + delta, 0) / startupFrameDeltas.length
      : 0;
    console.log(JSON.stringify({
      mapId,
      seed,
      quality,
      entryMilliseconds: browser.hudAt - browser.clickStarted,
      startupFps: startupMeanFrameMilliseconds > 0 ? 1_000 / startupMeanFrameMilliseconds : 0,
      startupFrameP95Milliseconds: percentile(startupFrameDeltas, 0.95),
      startupFrameP99Milliseconds: percentile(startupFrameDeltas, 0.99),
      startupLongFrames50: startupFrameDeltas.filter((delta) => delta > 50).length,
      startupLongFrames100: startupFrameDeltas.filter((delta) => delta > 100).length,
      stableFps: meanFrameMilliseconds > 0 ? 1_000 / meanFrameMilliseconds : 0,
      stableFrameP95Milliseconds: percentile(stableFrameDeltas, 0.95),
      stableFrameP99Milliseconds: percentile(stableFrameDeltas, 0.99),
      stableLongFrames50: stableFrameDeltas.filter((delta) => delta > 50).length,
      stableLongFrames100: stableFrameDeltas.filter((delta) => delta > 100).length,
      jsHeapUsedBytes: metric("JSHeapUsedSize"),
      nodes: metric("Nodes"),
    }));
  } finally {
    socket?.close();
    await stopChrome(chrome);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
