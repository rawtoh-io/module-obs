# Deployment

Module OBS deploys into the **shared rawtoh k3s cluster** (namespace `rawtoh`) — no change to the main `rawtoh-io/app` repo is required. Routing via Traefik, TLS via cert-manager. Deploys are automatic on push to `main`.

**Prerequisite:** the main cluster is up — see `DEPLOYMENT.md` in `rawtoh-io/app` (cert-manager issuer `letsencrypt-prod` and Traefik middleware `rawtoh-security-headers` must exist).

## Instructions

One-time setup, in order. Examples assume domain `rawtoh.io` — replace with yours.

### 1. DNS record

**Where:** your DNS provider.

**Example:** `obs.rawtoh.io  A  203.0.113.10` (same VPS IP as the main platform).

### 2. GitHub secret `KUBE_CONFIG`

**What:** the kubeconfig of the rawtoh cluster (the exact same value as in the main repo).

**Where:** this repo → _Settings → Secrets and variables → Actions → Secrets_.

### 3. GitHub variable `DOMAIN`

**Where:** this repo → _Settings → Secrets and variables → Actions → Variables_.

**Example:** `rawtoh.io`

### 4. Cluster secret `obs-secrets`

**Where:** copy `deploy/k8s/bootstrap/secrets.example.yaml` → `deploy/k8s/bootstrap/secrets.yaml` (gitignored), fill it in, then `kubectl apply -f deploy/k8s/bootstrap/secrets.yaml`.

**Example:**

```yaml
stringData:
  POSTGRES_PASSWORD: Q4wE8r2T6yU1iO5p
  DATABASE_URL: postgres://rawtoh:Q4wE8r2T6yU1iO5p@obs-postgres:5432/obs
  SESSION_SECRET: m3N6b9V2c5X8z1A4s7D0f3G6h9J2k5L8   # openssl rand -base64 32
  # Encrypts the Ed25519 private keys at rest. Distinct from SESSION_SECRET:
  # rotating the session secret only logs users out, rotating this one makes
  # every stored identity undecryptable and forces a re-enrollment per account.
  ENCRYPTION_KEY: 7pQ4mB9xK2vL6nR3sT8wY1cF5hJ0dG7zA4eU2iO9kM=  # openssl rand -base64 32
  # From the module instance registered on the Rawtoh platform
  # (shown once at creation):
  RAWTOH_CLIENT_ID: rth_c_8d4f1a6b3e9c...
  RAWTOH_CLIENT_SECRET: rth_s_5n2x8v4k7m1p...
```

### 5. Non-secret config

**Where:** `deploy/k8s/configmap.yaml` — committed in git. Nothing to edit: `$DOMAIN` is substituted at apply time.

### 6. Deploy

Push to `main` (CI does everything), or manually:

```sh
export DOMAIN=rawtoh.io
kubectl kustomize deploy/k8s | envsubst '$DOMAIN' | kubectl apply -f -
kubectl -n rawtoh rollout status deployment/obs-api
kubectl -n rawtoh rollout status deployment/obs-web
```

### 7. Verify

```sh
kubectl -n rawtoh get certificate obs-tls   # Ready=True (a minute or two)
curl -I https://obs.rawtoh.io               # 200 + security headers
```

Reminder: the SPA's CSP allows `connect-src ws: wss:` — the browser agent connects to obs-websocket on the streamer's machine (localhost/LAN).

## Operations

```sh
kubectl -n rawtoh logs -f deployment/obs-api
# Rollback (sha7 tags are kept on GHCR):
kubectl -n rawtoh set image deployment/obs-api api=ghcr.io/rawtoh-io/module-obs-api:production-<sha7>
```

## Self-hosting without k3s

Docker Compose standalone / external-proxy modes still work — see `README.md` and `.env.example`.
