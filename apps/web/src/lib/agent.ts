import { OBSWebSocket } from "obs-websocket-js";
import { OBS_EVENTS } from "@module-obs/shared/obs";
import type { AgentToServer, ServerToAgent } from "@module-obs/shared/obs";

// ---------------------------------------------------------------------------
// AgentClient — runs in the browser, on the streamer's machine.
//
// ONE WebSocket to the backend (per org) multiplexes every OBS connection:
// each attached account gets its own ObsHandle (obs-websocket-js instance),
// and all messages carry their accountId. OBS credentials are pushed by the
// backend on attach — nothing sensitive touches browser storage.
//
// Lifecycle: lives as long as the tab — closing it disconnects all OBS.
// ---------------------------------------------------------------------------

const WS_RETRY_MS = 3_000;
const OBS_RETRY_MS = 5_000;

export class AgentClient {
  private ws: WebSocket | null = null;
  private running = false;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = new Set<string>(); // accounts to keep attached
  private handles = new Map<string, ObsHandle>();

  constructor(private orgId: string) {}

  attach(accountId: string): void {
    if (!this.handles.has(accountId)) {
      this.handles.set(accountId, new ObsHandle(accountId, (msg) => this.send(msg)));
    }
    this.wanted.add(accountId);

    if (!this.running) {
      this.running = true;
      this.connectWs();
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "attach", accountId });
    }
  }

  detach(accountId: string): void {
    this.wanted.delete(accountId);
    this.send({ type: "detach", accountId });
    this.destroyHandle(accountId);
    if (this.wanted.size === 0) this.stop();
  }

  get empty(): boolean {
    return this.wanted.size === 0;
  }

  stop(): void {
    this.running = false;
    this.wanted.clear();
    if (this.wsTimer) clearTimeout(this.wsTimer);
    this.ws?.close();
    this.ws = null;
    for (const accountId of [...this.handles.keys()]) this.destroyHandle(accountId);
  }

  // ── Agent channel (backend) ──

  private connectWs(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/orgs/${this.orgId}/agent`);
    this.ws = ws;

    ws.onopen = () => {
      for (const accountId of this.wanted) {
        this.send({ type: "attach", accountId });
      }
    };
    ws.onmessage = (e) => {
      try {
        this.handleMessage(JSON.parse(e.data as string) as ServerToAgent);
      } catch {
        // malformed — ignore
      }
    };
    ws.onclose = () => {
      this.ws = null;
      // Tear down local OBS connections: attachments are server-side state
      // that died with the socket — handles are re-created on re-attach.
      for (const accountId of [...this.handles.keys()]) this.destroyHandle(accountId);
      if (this.running && this.wanted.size > 0) {
        this.wsTimer = setTimeout(() => this.connectWs(), WS_RETRY_MS);
      }
    };
    ws.onerror = () => {};
  }

  private send(msg: AgentToServer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: ServerToAgent): void {
    const handle = this.handles.get(msg.accountId);
    switch (msg.type) {
      case "connect":
        handle?.connectObs({ host: msg.host, port: msg.port, password: msg.password });
        break;
      case "disconnect":
        handle?.disconnectObs();
        break;
      case "call":
        void handle?.handleCall(msg.id, msg.requestType, msg.requestData);
        break;
      case "set-events":
        handle?.applyEvents(new Set(msg.events));
        break;
    }
  }

  private destroyHandle(accountId: string): void {
    const handle = this.handles.get(accountId);
    if (!handle) return;
    handle.destroy();
    this.handles.delete(accountId);
  }
}

// ── One OBS connection per attached account ──

class ObsHandle {
  private obs = new OBSWebSocket();
  private config: { host: string; port: number; password: string } | null = null;
  private obsWanted = false;
  private obsConnected = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private eventListeners = new Map<string, (data: unknown) => void>();
  private destroyed = false;

  constructor(
    private accountId: string,
    private sendFn: (msg: AgentToServer) => void,
  ) {
    this.obs.on("ConnectionClosed", () => this.onObsClosed());
    this.obs.on("ConnectionError", (err) => {
      console.warn(`[agent:${accountId}] OBS connection error: ${err instanceof Error ? err.message : err}`);
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.obsWanted = false;
    if (this.timer) clearTimeout(this.timer);
    void this.obs.disconnect().catch(() => {});
    this.obsConnected = false;
  }

  async connectObs(config: { host: string; port: number; password: string }): Promise<void> {
    this.config = config;
    this.obsWanted = true;
    if (this.destroyed) return;

    this.obsConnected = false;
    this.sendState("connecting");

    try {
      await this.obs.disconnect().catch(() => {});
      await this.obs.connect(`ws://${config.host}:${config.port}`, config.password || undefined);
      if (this.destroyed) return;
      this.obsConnected = true;
      this.sendState("connected");
      console.log(`[agent:${this.accountId}] Connected to OBS at ws://${config.host}:${config.port}`);
    } catch (err) {
      if (this.destroyed) return;
      this.sendState("error", err instanceof Error ? err.message : String(err));
      this.scheduleRetry();
    }
  }

  disconnectObs(): void {
    this.obsWanted = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.obs.disconnect().catch(() => {});
    if (this.obsConnected) {
      this.obsConnected = false;
      this.sendState("disconnected");
    }
  }

  async handleCall(id: string, requestType: string, requestData?: Record<string, unknown>): Promise<void> {
    try {
      // requestType is a runtime string proxied from the hub (obs.call
      // passthrough included) — bypass obs-websocket-js's literal union.
      const call = this.obs.call as (
        requestType: string,
        requestData?: Record<string, unknown>,
      ) => Promise<unknown>;
      const data = await call.call(this.obs, requestType, requestData);
      this.send({ type: "result", accountId: this.accountId, id, ok: true, data });
    } catch (err) {
      this.send({
        type: "result",
        accountId: this.accountId,
        id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Forward only the events the hub subscribed to (diffed against current)
  applyEvents(events: Set<string>): void {
    for (const [name, listener] of this.eventListeners) {
      if (!events.has(name)) {
        this.obs.removeListener(OBS_EVENTS[name] as never, listener as never);
        this.eventListeners.delete(name);
      }
    }
    for (const name of events) {
      if (this.eventListeners.has(name) || !(name in OBS_EVENTS)) continue;
      const listener = (data: unknown) => {
        this.send({ type: "event", accountId: this.accountId, event: name, data });
      };
      this.obs.on(OBS_EVENTS[name] as never, listener as never);
      this.eventListeners.set(name, listener);
    }
  }

  private send(msg: AgentToServer): void {
    this.sendFn(msg);
  }

  private sendState(state: "disconnected" | "connecting" | "connected" | "error", error?: string): void {
    this.send({ type: "obs-state", accountId: this.accountId, state, error });
  }

  private onObsClosed(): void {
    if (!this.obsConnected) return; // already reported (e.g. failed connect)
    this.obsConnected = false;
    this.sendState("disconnected");
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.destroyed || !this.obsWanted || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.config) void this.connectObs(this.config);
    }, OBS_RETRY_MS);
  }
}
