import { EventEmitter } from "events";
import type {
  AgentToServer,
  ObsAgentState,
  ServerToAgent,
} from "@module-obs/shared/obs";
import { getAccount, type Account } from "./db";

// ---------------------------------------------------------------------------
// Browser agent registry
//
// OBS listens on the streamer's localhost, unreachable from this hosted
// backend. The browser agent (the module's web app, tab open on the
// streamer's machine) holds the OBS connections; the backend proxies
// obs-websocket calls and events through it.
//
// ONE WebSocket per browser tab (an "agent session", scoped to an org)
// multiplexes every OBS connection: accounts are attached/detached over the
// session's lifetime and every message carries its accountId. This registry
// maps accountId → attachment → session socket, so callers only ever deal
// with accounts.
//
// Events:
//   "status"    → { accountId, orgId, obs: ObsAgentState }  (SSE fan-out)
//   "obs-event" → { accountId, event, data }                (hub fan-out)
// ---------------------------------------------------------------------------

// obs-websocket event data uses camelCase keys, but the hub convention (and
// the module manifest) is snake_case payloads — convert keys recursively.
function toSnakeCaseKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(toSnakeCaseKeys);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, v]) => [
				key.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`),
				toSnakeCaseKeys(v),
			]),
		);
	}
	return value;
}

export const agentEvents = new EventEmitter();

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AgentSocket {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
}

export interface AgentSession {
  id: string;
  orgId: string;
  ws: AgentSocket;
  accounts: Set<string>; // attached accountIds
}

interface Attachment {
  accountId: string;
  orgId: string;
  session: AgentSession;
  obsState: ObsAgentState;
  pending: Map<string, PendingCall>;
}

const sessions = new Map<string, AgentSession>();
const attachments = new Map<string, Attachment>(); // accountId → attachment
const desiredEvents = new Map<string, Set<string>>(); // accountId → rpc event names

const CALL_TIMEOUT_MS = 10_000;

function sendTo(session: AgentSession, msg: ServerToAgent): void {
  session.ws.send(JSON.stringify(msg));
}

function emitStatus(att: Attachment): void {
  agentEvents.emit("status", {
    accountId: att.accountId,
    orgId: att.orgId,
    obs: att.obsState,
  });
}

function emitDetached(att: Attachment): void {
  agentEvents.emit("status", {
    accountId: att.accountId,
    orgId: att.orgId,
    obs: "disconnected" satisfies ObsAgentState,
  });
}

function rejectAll(att: Attachment, message: string): void {
  for (const pending of att.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }
  att.pending.clear();
}

// ── Session lifecycle ──

export function createSession(orgId: string, ws: AgentSocket): AgentSession {
  const session: AgentSession = {
    id: crypto.randomUUID(),
    orgId,
    ws,
    accounts: new Set(),
  };
  sessions.set(session.id, session);
  console.log(`[agent] Session opened (org: ${orgId})`);
  return session;
}

export function destroySession(session: AgentSession, ws: AgentSocket): void {
  if (session.ws !== ws) return; // already replaced
  for (const accountId of [...session.accounts]) {
    detachAccount(session, accountId, "Agent disconnected");
  }
  sessions.delete(session.id);
  console.log(`[agent] Session closed (org: ${session.orgId})`);
}

// ── Attachment lifecycle ──

/**
 * Attach an account to a session: pushes the OBS connection settings and
 * the desired event subscriptions. If the account is attached elsewhere,
 * the older session loses it (single active tab wins per account).
 */
export function attachAccount(session: AgentSession, account: Account): void {
  if (account.orgId !== session.orgId) return; // paranoia — checked at route level

  const existing = attachments.get(account.id);
  if (existing) {
    if (existing.session.id === session.id) {
      // Re-attach on the same session: just refresh the config
      sendTo(session, {
        type: "connect",
        accountId: account.id,
        host: account.host,
        port: account.port,
        password: account.password,
      });
      return;
    }
    // Steal: tell the previous browser to drop this OBS connection
    sendTo(existing.session, { type: "disconnect", accountId: account.id });
    detachAccount(existing.session, account.id, "Agent replaced by a newer connection");
  }

  const att: Attachment = {
    accountId: account.id,
    orgId: account.orgId,
    session,
    obsState: "disconnected",
    pending: new Map(),
  };
  attachments.set(account.id, att);
  session.accounts.add(account.id);

  sendTo(session, {
    type: "connect",
    accountId: account.id,
    host: account.host,
    port: account.port,
    password: account.password,
  });

  const events = desiredEvents.get(account.id);
  if (events && events.size > 0) {
    sendTo(session, { type: "set-events", accountId: account.id, events: [...events] });
  }

  emitStatus(att);
  console.log(`[agent:${account.name}] Attached (org: ${account.orgId})`);
}

export function detachAccount(session: AgentSession, accountId: string, reason: string): void {
  const att = attachments.get(accountId);
  if (!att || att.session.id !== session.id) return;

  rejectAll(att, reason);
  attachments.delete(accountId);
  session.accounts.delete(accountId);
  emitDetached(att);
  console.log(`[agent:${accountId}] Detached (${reason})`);
}

// ── Messages from the browser ──

export async function handleAgentMessage(session: AgentSession, raw: string): Promise<void> {
  let msg: AgentToServer;
  try {
    msg = JSON.parse(raw) as AgentToServer;
  } catch {
    return;
  }

  switch (msg.type) {
    case "attach": {
      const account = await getAccount(msg.accountId);
      if (account && account.orgId === session.orgId) {
        attachAccount(session, account);
      }
      break;
    }
    case "detach": {
      detachAccount(session, msg.accountId, "Detached by the browser");
      break;
    }
    case "obs-state": {
      const att = owned(session, msg.accountId);
      if (!att) break;
      att.obsState = msg.state;
      emitStatus(att);
      break;
    }
    case "result": {
      const att = owned(session, msg.accountId);
      if (!att) break;
      const pending = att.pending.get(msg.id);
      if (!pending) break;
      clearTimeout(pending.timer);
      att.pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.data ?? {});
      } else {
        pending.reject(new Error(msg.error ?? "OBS call failed"));
      }
      break;
    }
    case "event": {
      const att = owned(session, msg.accountId);
      if (!att) break;
      agentEvents.emit("obs-event", {
        accountId: msg.accountId,
        event: msg.event,
        data: toSnakeCaseKeys(msg.data),
      });
      break;
    }
  }
}

/** The account must be attached to THIS session to accept its messages. */
function owned(session: AgentSession, accountId: string): Attachment | undefined {
  const att = attachments.get(accountId);
  return att && att.session.id === session.id ? att : undefined;
}

// ── Call routing (hub → OBS) ──

/** Call an obs-websocket request through the account's browser agent. */
export function callObs(
  accountId: string,
  requestType: string,
  requestData?: Record<string, unknown>,
): Promise<unknown> {
  const att = attachments.get(accountId);
  if (!att) {
    return Promise.reject(
      new Error("No browser agent connected — open the module page and connect OBS"),
    );
  }
  if (att.obsState !== "connected") {
    return Promise.reject(new Error(`OBS not connected (state: ${att.obsState})`));
  }

  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      att.pending.delete(id);
      reject(new Error("OBS call timed out"));
    }, CALL_TIMEOUT_MS);
    att.pending.set(id, { resolve, reject, timer });
    try {
      sendTo(att.session, { type: "call", accountId, id, requestType, requestData });
    } catch (err) {
      clearTimeout(timer);
      att.pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ── Event subscriptions (hub-driven) ──

/** Set the OBS events the agent must forward for an account. */
export function setDesiredEvents(accountId: string, events: Set<string>): void {
  desiredEvents.set(accountId, events);
  const att = attachments.get(accountId);
  if (att) {
    try {
      sendTo(att.session, { type: "set-events", accountId, events: [...events] });
    } catch {
      // dead socket — close event will clean up
    }
  }
}

// ── Accessors ──

export function getObsState(accountId: string): ObsAgentState {
  return attachments.get(accountId)?.obsState ?? "disconnected";
}

export function isAgentConnected(accountId: string): boolean {
  return attachments.has(accountId);
}

/** Push updated OBS connection settings to a live agent (after an account edit). */
export function pushObsConfig(account: Account): void {
  const att = attachments.get(account.id);
  if (!att) return;
  sendTo(att.session, {
    type: "connect",
    accountId: account.id,
    host: account.host,
    port: account.port,
    password: account.password,
  });
}

/** Detach an account whose row is being deleted. */
export function closeAgent(accountId: string): void {
  const att = attachments.get(accountId);
  if (!att) return;
  sendTo(att.session, { type: "disconnect", accountId });
  detachAccount(att.session, accountId, "Account removed");
}
