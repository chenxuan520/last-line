import { WebSocket } from "ws";
import {
  isServerMessage,
  MULTIPLAYER_PROTOCOL_VERSION,
  type RoomAdmission,
} from "../src/network/protocol";

const apiUrl = normalizeHttpUrl(
  process.env.MULTIPLAYER_SMOKE_URL ?? "https://lastlinep2p.011203.xyz",
);
const pageOrigin = normalizeOrigin(
  process.env.MULTIPLAYER_SMOKE_ORIGIN ?? "https://lastline.011203.xyz",
);

interface GuestCredentials {
  readonly playerId: string;
  readonly sessionToken: string;
  readonly displayName: string;
}

const guest = await postJson<GuestCredentials>("/v1/guests", {
  displayName: `CI Probe ${Date.now().toString(36)}`,
}, 201);
const admission = await postJson<RoomAdmission>("/v1/rooms", {
  ...guest,
  visibility: "private",
}, 201);

await verifyRoomSocket(admission);
console.log(`Production multiplayer smoke passed (protocol ${MULTIPLAYER_PROTOCOL_VERSION}).`);

async function postJson<T>(path: string, body: unknown, expectedStatus: number): Promise<T> {
  const response = await fetch(new URL(path, apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: pageOrigin,
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(body),
  });
  const value = await response.json() as T | { error?: string };
  if (response.status !== expectedStatus) {
    const error = typeof value === "object" && value !== null && "error" in value
      ? (value as { error?: string }).error
      : undefined;
    throw new Error(`${path} returned ${response.status}${error ? ` (${error})` : ""}`);
  }
  return value as T;
}

function verifyRoomSocket(admission: RoomAdmission): Promise<void> {
  const url = new URL(admission.socketPath, apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", admission.playerId);
  url.searchParams.set("token", admission.admissionToken);

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: pageOrigin });
    let welcomeReceived = false;
    let lobbyReceived = false;
    let leaveSent = false;
    let pendingFailure: Error | null = null;
    let settled = false;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      const error = new Error("Timed out waiting for the production multiplayer lobby");
      leaveWithFailure(error);
      if (!settled) cleanupTimer = setTimeout(() => finish(error), 1_000);
    }, 15_000);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cleanupTimer !== null) clearTimeout(cleanupTimer);
      if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      if (error) reject(error);
      else resolve();
    };

    const leaveWithFailure = (error: Error): void => {
      if (pendingFailure) return;
      pendingFailure = error;
      if (socket.readyState !== WebSocket.OPEN) {
        finish(error);
        return;
      }
      leaveSent = true;
      socket.send(JSON.stringify({ type: "lobby.leave" }));
    };

    socket.on("message", (raw) => {
      let value: unknown;
      try {
        value = JSON.parse(raw.toString()) as unknown;
      } catch {
        leaveWithFailure(new Error("Production multiplayer returned invalid JSON"));
        return;
      }
      if (!isServerMessage(value)) {
        leaveWithFailure(new Error("Production multiplayer returned an invalid server message"));
        return;
      }
      if (value.type === "error") {
        leaveWithFailure(new Error(`Production multiplayer error: ${value.code} (${value.message})`));
        return;
      }
      if (pendingFailure) return;
      if (value.type === "welcome") {
        welcomeReceived = true;
        socket.send(JSON.stringify({ type: "connection.ack" }));
        if (value.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
          leaveWithFailure(new Error(
            `Production protocol ${value.protocolVersion} does not match client protocol ${MULTIPLAYER_PROTOCOL_VERSION}`,
          ));
          return;
        }
        if (value.roomId !== admission.roomId || value.playerId !== admission.playerId) {
          leaveWithFailure(new Error("Production welcome does not match the room admission"));
        }
        return;
      }
      if (value.type === "lobby.state") {
        if (!welcomeReceived) {
          leaveWithFailure(new Error("Production lobby state arrived before welcome"));
          return;
        }
        if (!matchesAdmissionLobby(value.lobby, admission)) {
          leaveWithFailure(new Error("Production lobby state does not match the room admission"));
          return;
        }
        lobbyReceived = true;
        leaveSent = true;
        socket.send(JSON.stringify({ type: "lobby.leave" }));
      }
    });

    socket.on("close", (code, reason) => {
      if (pendingFailure) {
        finish(pendingFailure);
        return;
      }
      if (code !== 1000 || !welcomeReceived || !lobbyReceived || !leaveSent) {
        finish(new Error(`Production room closed early (${code}: ${reason.toString() || "no reason"})`));
        return;
      }
      finish();
    });
    socket.on("error", (error) => {
      if (!pendingFailure) finish(error);
    });
    socket.on("unexpected-response", (_request, response) => {
      finish(new Error(`Production WebSocket upgrade returned ${response.statusCode}`));
    });
  });
}

function matchesAdmissionLobby(value: unknown, admission: RoomAdmission): boolean {
  if (!isRecord(value)) return false;
  if (
    value.roomId !== admission.roomId
    || value.code !== admission.code
    || value.status !== "waiting"
    || !Array.isArray(value.members)
  ) return false;
  return value.members.some((member) =>
    isRecord(member)
    && member.playerId === admission.playerId
    && member.connected === true
    && member.host === true
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MULTIPLAYER_SMOKE_URL must use HTTP or HTTPS");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MULTIPLAYER_SMOKE_ORIGIN must use HTTP or HTTPS");
  }
  return url.origin;
}
