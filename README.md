# Module OBS

Control OBS Studio from Rawtoh automations — even though OBS lives on the
streamer's localhost. The module's web app bridges OBS to the hosted backend
through the browser.

See [AGENTS.md](./AGENTS.md) for the full architecture, patterns and commands.

## Quick start (dev)

```bash
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env   # cookie SSO by default — no OAuth client needed
bun install
bun run db:migrate
bun run dev            # API :10700, Web :10701
```

## Docker deployment (self-hosting)

The frontend is a self-contained nginx image (Vite static build served on
:80); the API is reverse-proxied. Images are built by GitHub Actions and
pulled from GHCR (add `--build` to build locally).

```bash
# Dedicated server (Caddy included, automatic TLS)
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d

# Behind your own reverse proxy (Caddy, Traefik, ...)
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
# -> set PROXY_NETWORK in .env, see docker-compose.proxy.yml
# -> with Caddy: copy caddy/module-obs.caddy into a directory imported
#    by your main Caddyfile (import /etc/caddy/sites/*.caddy), then reload
```

Required `.env` variables: see the Production section of `.env.example`.
The API Dockerfile runs migrations automatically at startup (`bun run migrate.ts`).

## k3s deployment (rawtoh.io production)

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full instructions (DNS, secrets, CI).

The module deploys into the shared k3s cluster (namespace `rawtoh`) —
kustomize manifests in `deploy/k8s/`:

```bash
export DOMAIN=rawtoh.io
kubectl kustomize deploy/k8s | envsubst '$DOMAIN' | kubectl apply -f -
```

Secrets are created once manually (`deploy/k8s/bootstrap/secrets.example.yaml`).
CI deploys automatically on push to `main` (secret `KUBE_CONFIG`, variable
`DOMAIN`). TLS via the cluster's `letsencrypt-prod` ClusterIssuer,
security headers via the shared Traefik middleware
`rawtoh-security-headers@kubernetescrd`.
