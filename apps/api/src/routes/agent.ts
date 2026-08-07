import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { requireAuth, resolveOrg } from "../middleware/auth";
import type { AuthEnv } from "../middleware/auth";
import { createSession, destroySession, handleAgentMessage } from "../agents";
import type { AgentSession } from "../agents";

// Bun WebSocket handlers — exported for Bun.serve (see index.ts)
export const { upgradeWebSocket, websocket } = createBunWebSocket();

const agentRoutes = new Hono<AuthEnv>();

// Browser agent channel — ONE socket per tab multiplexes every OBS
// connection of the org. Accounts are attached/detached over the
// session's lifetime (see packages/shared/src/obs.ts for the protocol).
agentRoutes.get(
  "/api/orgs/:orgId/agent",
  requireAuth,
  resolveOrg("owner"),
  upgradeWebSocket((c) => {
    const orgId = c.req.param("orgId")!;
    let session: AgentSession | null = null;
    return {
      onOpen(_evt, ws) {
        session = createSession(orgId, ws);
      },
      onMessage(evt) {
        if (!session) return;
        const data = typeof evt.data === "string" ? evt.data : evt.data.toString();
        void handleAgentMessage(session, data);
      },
      onClose(_evt, ws) {
        if (session) destroySession(session, ws);
      },
    };
  }),
);

export default agentRoutes;
