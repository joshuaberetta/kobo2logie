import type { KoboSubmission } from "./lib/kobo.js";

const MAX_BUFFER = 50;
const IDLE_ALARM_MS = 60_000; // 60 s after last connection closes

interface Env {
  FORM_SESSION: DurableObjectNamespace;
}

export class FormSession implements DurableObject {
  private buffer: KoboSubmission[] = [];
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocketUpgrade(request);
    }

    if (url.pathname === "/push" && request.method === "POST") {
      return this.handlePush(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ── WebSocket ────────────────────────────────────────────────────────────

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);

    // Cancel any pending idle alarm since we have a new connection
    await this.state.storage.deleteAlarm();

    // Send buffered submissions to the newly connected client
    for (const submission of this.buffer) {
      server.send(JSON.stringify(submission));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called by the Workers runtime when a WebSocket message is received
  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Clients don't send messages in this app — nothing to handle
  }

  // Called by the Workers runtime when a WebSocket closes
  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
    if (this.state.getWebSockets().length === 0) {
      await this.state.storage.setAlarm(Date.now() + IDLE_ALARM_MS);
    }
  }

  // Called by the Workers runtime when a WebSocket errors
  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    ws.close();
    if (this.state.getWebSockets().length === 0) {
      await this.state.storage.setAlarm(Date.now() + IDLE_ALARM_MS);
    }
  }

  // ── Push (from the POST /api/hook route) ────────────────────────────────

  private async handlePush(request: Request): Promise<Response> {
    let submission: KoboSubmission;
    try {
      submission = await request.json<KoboSubmission>();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Add to buffer, dropping oldest if over limit
    this.buffer.push(submission);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.shift();
    }

    // Broadcast to all open connections via the hibernation-safe API
    const message = JSON.stringify(submission);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // Dead socket — runtime will clean it up
      }
    }

    return new Response("OK", { status: 200 });
  }

  // ── Alarm (idle cleanup) ─────────────────────────────────────────────────

  async alarm(): Promise<void> {
    if (this.state.getWebSockets().length === 0) {
      this.buffer = [];
    }
  }
}
