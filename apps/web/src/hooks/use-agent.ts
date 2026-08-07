import { useSyncExternalStore } from "react";
import { AgentClient } from "@/lib/agent";

// Module-level agent registry — agents survive SPA navigation and only stop
// on explicit disconnect or tab close. One AgentClient per org multiplexes
// every attached account over a single WebSocket to the backend.
const clients = new Map<string, AgentClient>(); // orgId → client
const accountToClient = new Map<string, AgentClient>(); // accountId → client
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function startAgent(orgId: string, accountId: string): void {
  if (accountToClient.has(accountId)) return;
  let client = clients.get(orgId);
  if (!client) {
    client = new AgentClient(orgId);
    clients.set(orgId, client);
  }
  client.attach(accountId);
  accountToClient.set(accountId, client);
  notify();
}

export function stopAgent(accountId: string): void {
  const client = accountToClient.get(accountId);
  if (!client) return;
  client.detach(accountId);
  accountToClient.delete(accountId);
  notify();
}

/** Whether an OBS agent is running in THIS tab. */
export function useAgentActive(accountId: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => accountToClient.has(accountId),
  );
}
