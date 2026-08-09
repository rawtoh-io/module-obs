# Module OBS

Multi-tenant OBS Studio module. Unlike the other modules, OBS is not a hosted
API: obs-websocket listens on the streamer's machine (`ws://localhost:4455`,
password auth — no username in the protocol), unreachable from a hosted
backend. The module is therefore split in two runtime halves:

- **Backend** (hosted, `obs.<domain>`): org-scoped OBS accounts in PostgreSQL,
  Rawtoh OIDC auth, self-service install, and one Rawtoh hub connection per
  account (Ed25519 challenge/response, like the other modules).
- **Browser agent** (the module's web app, tab open on the streamer's
  machine): holds the actual OBS connection via `obs-websocket-js` and
  proxies calls/events with the backend over an authenticated WebSocket.

```
Rawtoh hub (wss://rpc.<domain>)
   ↕ Ed25519 challenge/response      (backend, always on once enrolled)
Backend obs.<domain> (Hono + Postgres)
   ↕ ONE WSS /api/orgs/:orgId/agent per browser tab (session cookie),
│    multiplexing N OBS connections (one per attached account)
Browser tab (obs-websocket-js)       — keep the tab open
   ↕ ws://localhost:4455 (password) × N accounts
OBS Studio
```

Consequence: RPC methods only work while a browser agent is connected — calls
fail fast with a descriptive JSON-RPC error otherwise.

## Stack

| Layer | Choice |
|-------|--------|
| API runtime | Bun |
| API framework | Hono (+ Bun WebSocket for the agent channel) |
| Database | PostgreSQL + Drizzle ORM |
| Frontend | React 19 + Vite 7 |
| Routing | TanStack Router (file-based) |
| Server state | TanStack React Query |
| OBS protocol | obs-websocket-js **in the browser** |
| External real-time | WebSocket JSON-RPC 2.0 (hub), WebSocket (agent), SSE (status) |
| Auth | OIDC (openid-client) + Hono sessions (server-side storage in `session` table) |
| Self-service install | User OIDC token (scope `module:install`) → one Rawtoh instance per OBS account (`POST /api/orgs/:orgId/accounts/:accountId/install`) |
| Module ↔ hub auth | Ed25519 key pair per OBS account, generated locally at enrollment; `session.challenge` nonce signed and returned in `session.register` |
| Monorepo | Turbo + Bun workspaces |
| Linter / Formatter | Biome |
| UI | Radix + Tailwind + shadcn |

## Structure

```
module-obs/
├── apps/
│   ├── api/                     # Hono backend (Bun runtime)
│   │   └── src/
│   │       ├── index.ts         # Hono app, middleware, route mounting, Bun WS export
│   │       ├── auth.ts          # OIDC utilities (discovery, PKCE, tokens, RFC 8707 resource)
│   │       ├── rawtoh-auth.ts   # Enrollment (one-shot token → key pair) + challenge signing
│   │       ├── session-storage.ts # @hono/session PostgreSQL storage (cookie carries sid only)
│   │       ├── agents.ts        # Agent sessions (1 WS/tab) + account attachments, call routing, OBS state
│   │       ├── connections.ts   # Hub WS connections per account (+ close codes, disconnect reasons)
│   │       ├── rpc.ts           # Hub JSON-RPC methods → obs-websocket proxy (table-driven)
│   │       ├── ws.ts            # WsClient (hub JSON-RPC 2.0, ping)
│   │       ├── db/
│   │       │   ├── schema.ts    # account, session
│   │       │   └── index.ts     # CRUD query functions
│   │       ├── middleware/
│   │       │   └── auth.ts      # requireAuth, resolveOrg
│   │       └── routes/
│   │           ├── auth.ts      # Login, callback, logout, /api/auth/me
│   │           ├── accounts.ts  # OBS account CRUD, install, enrollment, SSE status
│   │           └── agent.ts     # Agent WebSocket endpoint /api/orgs/:orgId/agent (+ Bun websocket export)
│   └── web/                     # React 19 + Vite frontend
│       └── src/
│           ├── lib/agent.ts     # AgentClient (1 WS/org) + ObsHandle (1 OBS conn/account)
│           ├── hooks/           # use-auth, use-accounts, use-agent
│           └── routes/          # / (orgs), /o/$orgSlug (OBS accounts)
├── packages/shared/
│   └── src/
│       ├── validation.ts        # Zod schemas + inferred types (accounts, org, user)
│       └── obs.ts               # OBS_EVENTS map + agent protocol message types
└── manifest.json                # Module definition: 59 methods, 22 events
```

## Code standards

Same as the other modules: Biome (tabs, double quotes, semicolons), kebab-case
files, camelCase vars, PascalCase components, snake_case SQL, SCREAMING_SNAKE_CASE
env vars, `strict: true`, hooks-only React Query (components never import
`@tanstack/react-query` directly).

## Key patterns

### RPC methods (hub → OBS)

Table-driven in `rpc.ts`: `OBS_METHODS` maps each RPC name to an obs-websocket
request type + param mapper. `obs.call({ requestType, requestData? })` is a
generic passthrough.

Field names are camelCase everywhere, matching the obs-websocket protocol
docs: responses and event payloads are both forwarded unchanged, and declared
param names follow suit. The param mappers still accept legacy snake_case
aliases (`scene_name`, `item_id`, …) so older scripts keep working — event
payloads have no such fallback.

### Agent protocol (backend ↔ browser)

Typed in `packages/shared/src/obs.ts` (`ServerToAgent` / `AgentToServer`).
ONE WebSocket per browser tab (per org) multiplexes every OBS connection —
every message carries its `accountId`. The browser drives attachment:

- Agent → backend: `attach` / `detach` (start/stop bridging an account),
  `obs-state`, `result`, `event`
- Backend → agent: `connect` (answer to `attach` — pushes OBS
  host/port/password, credentials never touch browser storage),
  `disconnect`, `call`, `set-events`

The socket closes when the last account is detached. One active attachment
per account: attaching from another tab steals the account (the old tab is
told to `disconnect`). `agents.ts` owns `desiredEvents` per account so hub
subscriptions survive agent reconnects, and maps `accountId → attachment →
session` so callers only deal with accounts.

### Hub connection management

Same pattern as module-twitch/module-board: first attempt in-band (HTTP routes
get immediate feedback), reconnect loop in background, exponential backoff
1s→64s, close codes 4000 (disconnect requested) / 4001 (secret rotated) stop
reconnection and set a `disconnectReason` surfaced in the UI over SSE.

### Status

SSE (`GET .../accounts/events`) merges both halves per account:
`{ hub: { connected, reason }, obs: "disconnected" | "connecting" | "connected" | "error" }`.

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Start API (:10700) + Web (:10701) in dev mode
bun run dev:api      # Start API only
bun run dev:web      # Start Web only
bun run build        # Production build
bun run lint         # Biome lint
bun run db:generate  # Generate Drizzle migrations
bun run db:migrate   # Run migrations
```

## Local dev

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL on :10702
cp .env.example .env                             # fill RAWTOH_CLIENT_ID/SECRET
bun run db:migrate
bun run dev
```

Requires a Rawtoh OAuth client (redirect URI `<APP_URL>/callback`, scopes
`openid profile email module:install`) and a module definition with slug `obs`
registered in Rawtoh (import `manifest.json`).

Env vars: see `.env.example`. Dev ports: API 10700, Web 10701, Postgres 10702.

## Deployment

Step-by-step setup: **[DEPLOYMENT.md](DEPLOYMENT.md)** (DNS, GitHub secrets/variables, cluster secrets, first deploy).

The SPA is a self-contained `nginx:alpine` image (build copied in, SPA fallback + CSP in `apps/web/nginx/`), reverse-proxied with the API by the layer in front. Images are built by GitHub Actions → `ghcr.io/rawtoh-io/module-obs-<api|web>:production` (+ `:production-<sha7>`).

**Production (rawtoh.io): k3s** — kustomize manifests in `deploy/k8s/`, deployed into the shared `rawtoh` namespace of the main cluster. CI applies them on push to `main` (`kubectl kustomize deploy/k8s | envsubst '$DOMAIN' | kubectl apply -f -` + rollout restart of changed deployments; secrets: `KUBE_CONFIG`, variable: `DOMAIN`). TLS via the cluster's `letsencrypt-prod` ClusterIssuer, security headers via the shared `rawtoh-security-headers@kubernetescrd` Traefik middleware (CSP is set by the web nginx). Secrets (`obs-secrets`) are created once manually from `deploy/k8s/bootstrap/secrets.example.yaml`. The module reaches the platform in-cluster: `ws://rpc:10006` (WS hub), `postgres` via its own `obs-postgres` pod.

**Self-hosting (Docker Compose):**

- `docker-compose.yml` — base production stack: `obs-postgres`, `obs-api` (:10700), `obs-web` (nginx :80)
- `caddy/module-obs.caddy` — the Caddy site block (`obs.<DOMAIN>`): proxied paths, SPA proxying. Single source reused by both modes
- `Caddyfile` — standalone entry point: global options + `import /etc/caddy/module-obs.caddy`
- `docker-compose.caddy.yml` — standalone override: adds the `caddy` service (ports 80/443, env `DOMAIN` + `ACME_EMAIL`)
- `docker-compose.proxy.yml` — external-proxy override: joins an existing Docker network (`PROXY_NETWORK` in `.env`) so your own reverse proxy can reach `obs-api:10700` and `obs-web:80`. With Caddy in front: drop `caddy/module-obs.caddy` into a directory imported by your main Caddyfile, then `caddy reload`

```bash
# Standalone (own server)
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d

# Behind your own reverse proxy
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

Required `.env` (compose production): `PUBLIC_DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `RAWTOH_CLIENT_ID`, `RAWTOH_CLIENT_SECRET`, `RAWTOH_ISSUER`, `RAWTOH_WS_URL` (+ `ACME_EMAIL` standalone, `PROXY_NETWORK` external-proxy).

CSP note: the obs-web nginx CSP allows `connect-src 'self' ws: wss:` — the
browser agent must reach obs-websocket on the user's machine (localhost/LAN).
