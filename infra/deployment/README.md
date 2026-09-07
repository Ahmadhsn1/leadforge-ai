# Deploying LeadForge

Three stateless services (`web`, `api`, `worker`) plus managed PostgreSQL and
Redis. Everything is a container; nothing writes to local disk.

---

## 1. Provision

| Component      | Requirement                    | Notes                                                                                |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| PostgreSQL     | 16+, 2 vCPU / 4 GB to start    | Automated daily backups with a **tested** restore. Untested backups are not backups. |
| Redis          | 7+, 1 GB                       | Must be `maxmemory-policy noeviction`. Evicting a key silently loses queued jobs.    |
| `api`          | 1 vCPU / 1 GB, ≥2 replicas     | Stateless behind a load balancer.                                                    |
| `worker`       | 1 vCPU / 2 GB, 1–4 replicas    | Scale on queue depth.                                                                |
| `web`          | 0.5 vCPU / 512 MB, ≥2 replicas |                                                                                      |
| Secret manager | —                              | Environment variables are secrets, not config.                                       |

The services need no shared filesystem and no sticky sessions: the session lives
in the database, so any replica can serve any request.

---

## 2. Configure

Every variable is listed in `.env.example`. These must be set, and the API
refuses to start in production without them:

```bash
APP_ENV=production
AUTH_SECRET=            # openssl rand -hex 32 — rotating it signs everyone out
COOKIE_SECURE=true
DATABASE_URL=
REDIS_URL=
APP_URL=https://app.yourdomain.com
API_URL=https://api.yourdomain.com
CORS_ORIGINS=https://app.yourdomain.com
```

`packages/config` validates all of this at boot and refuses to start with a weak
`AUTH_SECRET`, `COOKIE_SECURE=false`, or `ALLOW_PRIVATE_NETWORK_FETCH=true` in
production. A misconfigured deploy fails immediately and loudly rather than
running insecurely.

Provider keys (`OPENROUTER_API_KEY`, `GOOGLE_MAPS_API_KEY`, Meta, SMTP) are
optional — each unconfigured provider disables its feature and says so in
**Settings → Integrations**. Set them on both `api` and `worker`.

### Networking

- `web` needs `API_URL` reachable on the internal network. The browser only ever
  calls `web`'s own origin; `web` proxies to `api` with the cookie attached.
- `api` must be reachable from the internet for provider webhooks:
  `POST https://api.yourdomain.com/webhooks/whatsapp` and `/webhooks/instagram`.
- `worker` needs no inbound traffic beyond its health port.

---

## 3. Build and migrate

```bash
docker build -f infra/docker/api.Dockerfile    -t leadforge-api:$SHA .
docker build -f infra/docker/worker.Dockerfile -t leadforge-worker:$SHA .
docker build -f infra/docker/web.Dockerfile    -t leadforge-web:$SHA \
  --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com .
```

Migrations run as a job **before** the new images roll out, never from an
application container:

```bash
pnpm --filter @leadforge/database exec prisma migrate deploy
```

Order matters: `worker` last, so it never picks up a job whose payload shape the
running API does not yet produce.

```
migrate → api → web → worker
```

### Backward compatibility

Deploys overlap, so old and new code run simultaneously for a minute or two.
A destructive migration must therefore be split across two releases:

1. **Release A** — add the new column, write to both, read from the old.
2. **Release B** — read from the new column, drop the old one.

Job payloads carry `inputVersion` for the same reason: a worker can recognise a
payload shape it does not understand instead of misreading it.

---

## 4. Health and probes

| Endpoint                    | Purpose                                                        | Auth    |
| --------------------------- | -------------------------------------------------------------- | ------- |
| `GET /health`               | Liveness. Cheap; answers even when the database is struggling. | public  |
| `GET /health/ready`         | Readiness. Fails when Postgres or Redis is unreachable.        | public  |
| `GET /health/detail`        | Full status incl. queue depth and provider configuration.      | session |
| `GET :4001/health` (worker) | Worker liveness.                                               | public  |

Use `/health` for liveness and `/health/ready` for readiness. Pointing liveness
at `/health/ready` would restart a healthy pod during a brief database blip.

---

## 5. Scaling

**API** scales on CPU and request latency.

**Worker** scales on queue depth — visible at `/health/detail` or in
**Settings → Health**. Per-queue concurrency and rate limits are in
`packages/shared/src/constants/queues.ts`; the provider-facing queues
(discovery, enrichment, intelligence, outreach) are rate-limited there so extra
replicas increase throughput without exceeding a provider's limits.

A growing `waiting` count with a flat `active` count means workers are saturated.
A growing `failed` count means something is wrong — check the dead-letter rows in
the `jobs` table, which retain the payload and the error.

---

## 6. Operations

**Monitor:** queue backlog, dead-letter count, AI spend against
`AI_MONTHLY_USD_BUDGET`, provider error rate, webhook signature failures, p95
request latency.

**Logs** are structured JSON carrying `requestId`, `organizationId`, `jobId`,
`campaignId` and `leadId`. One request or job is a single filter away, from HTTP
entry through worker to provider call. Secrets are redacted by the logger, not by
convention.

**Backups:** daily automated, with a documented restore procedure that has
actually been run. `pnpm db:migrate:deploy` is idempotent, so a restored database
can be brought to the current schema safely.

**Rollback:** redeploy the previous image tag. Because migrations are split
across releases, the previous version keeps working against the current schema.

---

## 7. Before the first real campaign

- [ ] `AUTH_SECRET` is a fresh 32-byte random value from the secret manager
- [ ] `COOKIE_SECURE=true` and the app is served over HTTPS
- [ ] Database backups are running **and a restore has been tested**
- [ ] Redis is `noeviction`
- [ ] `META_APP_SECRET` is set — webhooks are rejected without it
- [ ] `AI_MONTHLY_USD_BUDGET` reflects a spend you are willing to incur
- [ ] Provider webhooks point at the public API URL and the subscription
      handshake has succeeded
- [ ] Legal advice obtained on lawful basis and contact rules for your market
      (see `docs/31-COMPLIANCE-DESIGN.md`) — the platform is built to support
      compliance, but it cannot determine what is lawful for your campaign
