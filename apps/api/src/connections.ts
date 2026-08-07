import { EventEmitter } from "events";
import { WsClient } from "./ws";
import { registerMethods } from "./rpc";
import { signChallenge, type RawtohIdentity } from "./rawtoh-auth";
import { agentEvents, setDesiredEvents } from "./agents";
import { listAllAccounts, type Account } from "./db";

// The hub this module is deployed against. A module talks to exactly one, so
// this is deployment config rather than something discovered per instance.
const RAWTOH_WS_URL = process.env.RAWTOH_WS_URL || "ws://127.0.0.1:10006";

// Close codes sent by the Rawtoh hub — do NOT reconnect on these
// (4000: disconnect requested, 4001: instance re-enrolled against another key).
const NO_RECONNECT_CODES = new Set([4000, 4001]);

export type DisconnectReason = "disconnect-requested" | "key-rotated";

// Why the hub last refused reconnection, per account (in-memory, best effort —
// surfaced in the UI so a rotated key doesn't look like a mere "offline").
const disconnectReasons = new Map<string, DisconnectReason>();

export function getDisconnectReason(accountId: string): DisconnectReason | null {
  return disconnectReasons.get(accountId) ?? null;
}

export const connectionEvents = new EventEmitter();

interface AccountConnection {
  accountId: string;
  accountName: string;
  orgId: string;
  wsClient: WsClient | null;
  stopping: boolean;
  subscriptions: Map<string, string>; // subId → rpc event name
  identity: RawtohIdentity;
}

const connections = new Map<string, AccountConnection>();

// OBS events forwarded by the browser agent → hub notifications
agentEvents.on(
  "obs-event",
  ({ accountId, event, data }: { accountId: string; event: string; data: unknown }) => {
    const conn = connections.get(accountId);
    if (!conn?.wsClient) return;
    for (const [subId, name] of conn.subscriptions) {
      if (name === event) {
        conn.wsClient.notify("event.subscription", { subscription: subId, result: data });
        return;
      }
    }
  },
);

async function connectAccount(account: Account): Promise<void> {
  if (connections.has(account.id)) return;
  if (!account.instanceId || !account.privateKey) return;

  const conn: AccountConnection = {
    accountId: account.id,
    accountName: account.name,
    orgId: account.orgId,
    wsClient: null,
    stopping: false,
    subscriptions: new Map(),
    identity: { instanceId: account.instanceId, privateKey: account.privateKey },
  };
  connections.set(account.id, conn);

  // First connection attempt runs in-band so callers (HTTP routes, startup)
  // get immediate feedback; the reconnect loop continues in background.
  try {
    await tryConnect(conn);
  } catch (err) {
    connections.delete(conn.accountId);
    throw err;
  }
  disconnectReasons.delete(conn.accountId);
  connectionEvents.emit("status", { accountId: conn.accountId, orgId: conn.orgId, connected: true, reason: null });

  void connectLoop(conn);
}

async function tryConnect(conn: AccountConnection): Promise<void> {
  const { instanceId } = conn.identity;
  console.log(`[ws:${conn.accountName}] Connecting to ${RAWTOH_WS_URL}...`);
  const client = await WsClient.connect(RAWTOH_WS_URL);
  registerMethods(client, conn);

  // Challenge/response: the hub issues a nonce, we sign it with the private
  // key generated at enrollment. Both calls must land inside the hub's 5s
  // registration window.
  const challenge = (await client.request("session.challenge", { instance_id: instanceId })) as {
    nonce?: string;
  };
  if (!challenge?.nonce) {
    client.close();
    throw new Error("Hub returned no challenge");
  }

  const result = await client.request("session.register", {
    instance_id: instanceId,
    signature: await signChallenge(conn.identity, challenge.nonce),
  });

  if (result !== true) {
    client.close();
    throw new Error("Registration rejected");
  }

  console.log(`[ws:${conn.accountName}] Registered successfully`);
  conn.wsClient = client;
}

async function connectLoop(conn: AccountConnection): Promise<void> {
  let delaySecs = 1;

  while (!conn.stopping) {
    // Wait for the active connection to drop
    const client = conn.wsClient;
    if (!client) break;

    const closeCode = await client.waitClosed();
    console.log(`[ws:${conn.accountName}] Disconnected (code: ${closeCode})`);
    conn.wsClient = null;
    conn.subscriptions.clear();
    setDesiredEvents(conn.accountId, new Set());

    let reason: DisconnectReason | null = null;
    if (closeCode != null && NO_RECONNECT_CODES.has(closeCode)) {
      reason = closeCode === 4001 ? "key-rotated" : "disconnect-requested";
      disconnectReasons.set(conn.accountId, reason);
      console.log(`[ws:${conn.accountName}] Close code ${closeCode} — not reconnecting`);
    }

    if (!conn.stopping) {
      connectionEvents.emit("status", { accountId: conn.accountId, orgId: conn.orgId, connected: false, reason });
    }

    if (reason) break;

    // Reconnect with exponential backoff until success or stop
    while (!conn.stopping) {
      console.log(`[ws:${conn.accountName}] Reconnecting in ${delaySecs}s...`);
      await new Promise((r) => setTimeout(r, delaySecs * 1000));
      delaySecs = Math.min(delaySecs * 2, 64);
      if (conn.stopping) break;

      try {
        await tryConnect(conn);
        delaySecs = 1;
        disconnectReasons.delete(conn.accountId);
        connectionEvents.emit("status", { accountId: conn.accountId, orgId: conn.orgId, connected: true, reason: null });
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ws:${conn.accountName}] Connection error: ${msg}`);
        conn.wsClient = null;
      }
    }
  }

  // Only delete if this conn is still the active one (avoid deleting a newer connection from reconnectAccount)
  if (connections.get(conn.accountId) === conn) {
    connections.delete(conn.accountId);
  }
}

export function isAccountConnected(accountId: string): boolean {
  const conn = connections.get(accountId);
  return !!conn && !conn.stopping && !!conn.wsClient;
}

export function getAccountWsClient(accountId: string) {
  return connections.get(accountId)?.wsClient ?? null;
}

export function disconnectAccount(accountId: string): void {
  const conn = connections.get(accountId);
  if (!conn) return;
  conn.stopping = true;
  if (conn.wsClient) conn.wsClient.terminate();
  connections.delete(accountId);
  disconnectReasons.delete(accountId);
  connectionEvents.emit("status", { accountId, orgId: conn.orgId, connected: false, reason: null });
  console.log(`[ws:${accountId}] Stopped`);
}

export async function reconnectAccount(account: Account): Promise<void> {
  disconnectAccount(account.id);
  await connectAccount(account);
}

export async function startAllConnections(): Promise<void> {
  const accounts = await listAllAccounts();
  const enrolled = accounts.filter((a) => a.instanceId && a.privateKey);
  console.log(`[ws] Starting connections for ${enrolled.length} account(s)...`);
  for (const account of enrolled) {
    connectAccount(account).catch((err) => {
      console.error(
        `[ws:${account.name}] Initial connection failed: ${err instanceof Error ? err.message : err}`,
      );
    });
  }
}
