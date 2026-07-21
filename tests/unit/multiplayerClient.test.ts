import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiplayerConnection, resolveMultiplayerApiUrl } from "../../src/network/MultiplayerClient";
import type { RoomAdmission } from "../../src/network/protocol";

describe("MultiplayerConnection lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels reconnects and ignores late socket events after close", async () => {
    vi.useFakeTimers();
    const sockets: FakeWebSocket[] = [];
    const connection = new MultiplayerConnection(
      "https://example.test",
      admission(),
      () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    );
    const messages = vi.fn();
    const statuses = vi.fn();
    connection.setMessageHandler(messages);
    connection.setStatusHandler(statuses);
    const opened = connection.open();
    sockets[0]?.open();
    await opened;

    sockets[0]?.serverClose(1006);
    connection.close();
    sockets[0]?.serverMessage(JSON.stringify({ type: "error", code: "late", message: "late" }));
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sockets).toHaveLength(1);
    expect(messages).not.toHaveBeenCalled();
    expect(statuses).toHaveBeenLastCalledWith("closed");
    expect(sockets[0]?.closeCalls).toBe(1);
    connection.close();
    expect(sockets[0]?.closeCalls).toBe(1);
  });
});

describe("multiplayer API selection", () => {
  it("uses the page origin for a standalone full-stack build", () => {
    expect(resolveMultiplayerApiUrl("true", "same-origin", {
      origin: "https://self-hosted.example.test",
      hostname: "self-hosted.example.test",
    })).toBe("https://self-hosted.example.test/");
  });

  it("keeps explicit Cloudflare URLs and the disabled switch", () => {
    expect(resolveMultiplayerApiUrl("true", "https://api.example.test/path", null))
      .toBe("https://api.example.test/");
    expect(resolveMultiplayerApiUrl("false", "same-origin", {
      origin: "https://self-hosted.example.test",
      hostname: "self-hosted.example.test",
    })).toBeNull();
  });
});

class FakeWebSocket extends EventTarget {
  public readyState: number = WebSocket.CONNECTING;
  public closeCalls = 0;

  public send(): void {}

  public close(): void {
    this.closeCalls += 1;
    this.readyState = WebSocket.CLOSED;
  }

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  public serverClose(code: number): void {
    this.readyState = WebSocket.CLOSED;
    const event = new Event("close");
    Object.defineProperty(event, "code", { value: code });
    this.dispatchEvent(event);
  }

  public serverMessage(data: string): void {
    const event = new Event("message");
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
}

function admission(): RoomAdmission {
  return {
    roomId: "room-1",
    code: "ABC123",
    playerId: "guest-1",
    admissionToken: "token",
    socketPath: "/v1/rooms/room-1/socket",
  };
}
