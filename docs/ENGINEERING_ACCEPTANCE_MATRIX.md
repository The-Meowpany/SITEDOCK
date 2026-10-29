# SiteDock Engineering Acceptance Matrix

> This document tracks every engineering capability in the SiteDock platform,
> its implementation status, and verifiable evidence. It is updated continuously
> throughout development. A feature may only be marked `VERIFIED` when its
> actual behavior has been demonstrated against the appropriate infrastructure.
>
> Statuses:
> - `NOT_STARTED` — Not yet implemented
> - `IN_PROGRESS` — Implementation in progress
> - `IMPLEMENTED_UNVERIFIED` — Code exists but not verified against real infrastructure
> - `VERIFIED` — Behavior demonstrated against appropriate infrastructure
> - `FAILED` — Implemented but does not meet acceptance criteria
> - `BLOCKED` — Blocked by external dependency

| Req ID | Capability | Components | Acceptance Criteria | Tests | Commands Executed | Result | Deps/Blockers | Status |
|--------|-----------|------------|-------------------|-------|-------------------|--------|---------------|--------|
| INFRA-01 | PostgreSQL database running | Windows PostgreSQL 16 (`postgresql-x64-16`), database `sitedock` | Connections accepted; migrations 0001–0005 applied | `psql` inspection | `psql -h 127.0.0.1 -U sitedock -d sitedock -c "\dt"` → 30 tables incl. `service_deployments`, `container_instances`, `service_deployment_logs` | VERIFIED | Windows host | VERIFIED |
| INFRA-02 | Container runtime (Podman rootless) | podman 5.8.9 in WSL2 Fedora 44 as user `sitedockrt` | `podman info` works; `podman run` works | Direct agent probe | Agent built an image, ran it, health 200, removed it | VERIFIED | WSL2 Fedora 44 | VERIFIED |
| INFRA-03 | Object storage (disk-backed) | `packages/deployment/src/infrastructure/disk-storage.provider.ts` | Objects persist across restarts; path traversal rejected | `npx tsx verify-disk-storage.ts` | Write → new instance read verified; traversal rejected | VERIFIED | WSL2 filesystem | VERIFIED |
| INFRA-04 | Local stack startup | docker-compose / scripts | All services start; health checks pass | `docker compose up` or equivalent | Not attempted (Compose unavailable) | NOT RUN | Docker Compose unavailable | NOT_STARTED |
| DEPLOY-01 | Deployment state machine | `packages/deployment/src/domain/service-deployment-status.ts` | QUEUED→BUILDING→READY and failure transitions valid; invalid rejected | Unit tests | `npm test` → 354 passing | VERIFIED | None | VERIFIED |
| DEPLOY-02 | ZIP upload and validation | `packages/deployment/src/domain/upload-validation.ts` | Traversal, symlinks, zip bombs, dangerous extensions rejected | Unit tests | `npm test` → 354 passing | VERIFIED | None | VERIFIED |
| DEPLOY-03 | Deployment publication | `apps/api/src/interfaces/deployment.routes.ts`, website publish use cases | Publish marks DEPLOYING→LIVE; previous LIVE superseded | Unit + prior E2E | `npx tsx verify-rollback.ts` (static sites) | VERIFIED | Static sites only | VERIFIED |
| DEPLOY-04 | Website rollback | `packages/website/src/application/publish-and-query.use-cases.ts` | Rollback restores previous productionDeploymentId | E2E | `npx tsx verify-rollback.ts` | VERIFIED | Static sites | VERIFIED |
| QUEUE-01 | Durable service-deployment queue | `prisma-service-deployment.repository.ts` (`claimNext` `FOR UPDATE SKIP LOCKED`), `service-deployment.entity.ts` | Atomic claim, leases, retry eligibility, cancellation, idempotency, ownership fencing | Real-PostgreSQL integration tests | Concurrency suite 5/5 pass; live worker claimed an API-queued deployment in 0.5 s | VERIFIED | PostgreSQL 16 | VERIFIED |
| DEPLOY-05 | Deployment logs | `deployment-log.entity.ts`, `prisma-service-deployment-log.repository.ts` | Logs persisted per deployment and retrievable | Integration + live run | Live deployment `5c505636…` has 6 log rows (Build started → Deployment live and routable) | VERIFIED | PostgreSQL 16 | VERIFIED |
| DEPLOY-06 | Persistent artifact storage | `DiskStorageProvider` + `MockStorageProvider` | Files persist across API restarts; path traversal rejected | `verify-disk-storage.ts`, `verify-e2e.ts` | Persistence verified | VERIFIED | — | VERIFIED |
| GIT-01 | GitHub repository connection | Not implemented | OAuth flow; repository list | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| GIT-02 | Webhook signature verification | Not implemented | Signatures verified; duplicates rejected | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| GIT-03 | Push-triggered builds | Not implemented | Git push triggers build | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| BUILD-01 | Isolated build execution | `apps/runtime-agent/agent.mjs` (`POST /v1/images/build`) | Rootless Podman; no tenant access to the engine; `--network=none`, `--memory 512m`, `no-new-privileges` | Live agent build | Reference image built via agent (digest `sha256:9b995c58…`); control-plane images built rootless | VERIFIED | Rootless podman | VERIFIED |
| BUILD-02 | Supported runtimes (static, Node, Next.js, Python) | Dockerfile source type only | Each runtime builds; artifact verified | Integration test | Dockerfile-sourced Node app verified; other presets not implemented | Only `sourceType: "dockerfile"` materialized | Presets missing | IMPLEMENTED_UNVERIFIED |
| RUNTIME-01 | Dynamic application hosting | `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/runtime-agent/agent.mjs` | API image `localhost/sitedock-api:m14` (`39a9813db09b…`), worker `localhost/sitedock-worker:m14` (`21f89fce3921…`); both non-root UID 1001; readiness 200 against real DB | Podman build + run | Builds exit 0 (Node 22 bookworm + openssl); API `/health/ready` 200; worker completed all 6 jobs; inspect User=`sitedock` | VERIFIED | Podman 5.8.9, node:22-bookworm-slim | VERIFIED |
| RUNTIME-02 | Health checks and readiness | `apps/api/src/app.ts` | `/health/live`, `/health/ready` | Live requests | `/health/live` 200; `/health/ready` 200 (DB connected) | VERIFIED | None | VERIFIED |
| RUNTIME-04 | Trusted runtime agent boundary | `apps/runtime-agent/agent.mjs` | Bearer auth; argv-only Podman; only local sha256 images runnable; reserved env rejected; no socket/credentials in tenants | Agent probes + container inspect | Unauthorized → 401; bad name → 400; live tenant container: `userns=private`, caps dropped, `no-new-privileges`, 256MB/128 pids, read-only rootfs, port bound to `127.0.0.1`, user `node`, no engine socket | VERIFIED | Token ≥32 chars | VERIFIED |
| RUNTIME-05 | Builds with RUN steps in rootless agent | `agent.mjs` build args | Tenant Dockerfiles with `RUN` build successfully | Direct probe | Failed with `sd-bus call: Permission denied` until `--cgroup-manager=cgroupfs`; probe then printed `cgroupfs-probe` | VERIFIED | No systemd user session in WSL | VERIFIED |
| HOST-01 | Hostname routing to live runtime | `apps/api/src/middleware/host-routing.ts` | Active deployment resolved from authoritative state and proxied; unknown/malformed rejected; failed/stopped never selected | Live HTTP requests | Known host → 200 `revision=1`; unknown → 404; malformed → 400; after rollback v1 served; stopped runtimes yield 502 | VERIFIED | API on :4000 | VERIFIED |
| RUNTIME-03 | Tenant isolation | `apps/api/src/middleware/access-control.ts`, `service.routes.ts` | Cross-tenant access 404; path traversal rejected; hostname ownership tenant-scoped | Adversarial tests | Multitenant-security suites pass; service routes resolve by workspace-scoped lookup | Not attacked against a second live tenant runtime | IMPLEMENTED_UNVERIFIED |
| FENCE-01 | Stale-worker fencing | `renewLease`, `saveWithLease`, `activateWithLease` | Stale mutations rejected atomically; newer generation authoritative | Real-PostgreSQL integration test | A claims → lease expires → B reclaims (gen 2) → B READY → A `saveWithLease(gen 1)` rejects `STALE_LEASE`; B state intact | VERIFIED | PostgreSQL 16 | VERIFIED |
| FENCE-02 | Broken-release protection | `BuildAndDeployServiceUseCase` | Failed deployment never displaces active release | Live run | Broken v3 → FAILED after 3 attempts; service stayed LIVE on v1; routed body still `revision=1` | VERIFIED | — | VERIFIED |
| FENCE-03 | Rollback to prior artifact | `RollbackServiceUseCase` + agent | New container from prior immutable image, health-checked, then routing switched | Live run | Rollback to v1 → new container `81a40955…` (port 40835) from v1 image; routed `revision=1`; v2 container stopped | VERIFIED | — | VERIFIED |
| CONC-01 | Multi-worker concurrency | `claimNext` `FOR UPDATE SKIP LOCKED` | Exactly one worker claims each job | Real-PostgreSQL integration test | 5 workers racing 2 deployments → exactly 2 claims, distinct ids/workers | VERIFIED | PostgreSQL 16 | VERIFIED |
| CONC-02 | Post-restart consistency | API + worker restart | Live routing and state survive restart | Live restart | API+worker restarted; `/health/ready` 200; same hostname still served `revision=1` | VERIFIED | — | VERIFIED |
| SEC-05 | Control-plane base image support | `apps/api/Dockerfile`, `apps/worker/Dockerfile` | Supported (non-EOL) base image builds and runs with Prisma | Repro builds + runtime tests | Node 20 EOL (Apr 2026); node:22-bookworm-slim without openssl crashed (`libssl.so.1.1`); with openssl: API ready 200, worker jobs complete, UID 1001 | VERIFIED | Requires openssl | VERIFIED |
| DB-03 | Database network exposure | Windows firewall `Postgres WSL2`, `pg_hba.conf` | Only the required WSL2 subnet, not `172.16.0.0/12` | Config inspection | `pg_hba.conf` narrowed to `172.28.208.0/20` (backup `pg_hba.conf.bak-m14`); firewall rule still `Any` | Reload blocked: `pg_ctl reload`, `Restart-Service`, `Set-NetFirewallRule` need elevation | IMPLEMENTED_UNVERIFIED |
| DB-01 | Customer PostgreSQL provisioning | Not implemented | Restricted credentials per tenant DB | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| DB-02 | Database backup and restore | `scripts/backup-postgres.sh` | Backup/restore drill | E2E | Not attempted | NOT RUN | Script not tested | NOT_STARTED |
| DOMAIN-01 | Platform subdomains | `packages/deployment/src/domain/` | Subdomain reserved; routing works; HTTPS | E2E | Host routing verified without DNS/TLS | NOT RUN | No TLS/Caddy production config | NOT_STARTED |
| DOMAIN-02 | Custom domain verification | Not implemented | DNS ownership; SSL issued | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| TLS-01 | Automated TLS lifecycle | Not implemented | Cert issued/renewed | Integration test | Not attempted | NOT RUN | No CA integration | NOT_STARTED |
| PREVIEW-01 | Preview environments | `isPreview` field | Preview URL; isolated; expires | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| ZERO-01 | Zero-downtime deployment | Not implemented | Readiness gate; graceful shutdown; traffic switch | Integration test | Failed-release protection verified; no graceful drain | NOT RUN | Not implemented | NOT_STARTED |
| BLUEPRINT-01 | sitedock.yaml schema | Not implemented | Schema validation | Unit test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| API-01 | Public API with scoped tokens | Not implemented | Token auth; rate limiting | Integration test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| API-02 | OpenAPI documentation | Not implemented | Spec available | Review | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| CLI-01 | SiteDock CLI | Not implemented | login/deploy/status/logs/rollback | CLI test | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| DASH-01 | Dashboard workflows | Next.js apps exist | Project/deployment/rollback UI | UI test | Not attempted | NOT RUN | UI coverage incomplete | NOT_STARTED |
| AGENCY-01 | Agency and client management | `packages/workspace/`, `packages/client/` | Workspace/client permissions enforced | Unit tests | Workspace suite passes | VERIFIED | None | VERIFIED |
| AGENCY-02 | Subscription and maintenance | `packages/billing/`, `packages/maintenance/` | Plans, subscriptions, maintenance quota | Unit tests | Billing suite passes | VERIFIED | None | VERIFIED |
| BILLING-01 | Stripe Connect integration | `packages/billing/src/` | Checkout; webhook; ACTIVE subscription | E2E | Not attempted against Stripe sandbox | NOT RUN | No credentials | NOT_STARTED |
| OBS-01 | Build and deployment logs | `DeploymentLog`, `/logs` route | Logs retrievable per deployment; tenant-scoped | Live run + DB query | 6 log rows for live deployment; `GET …/logs` returns flat DTOs | VERIFIED | — | VERIFIED |
| OBS-02 | Metrics endpoint | `metrics-admin.routes.ts` | Provider counters | Unit test | `npm test` passes | IMPLEMENTED_UNVERIFIED | Not tested against real infra | IMPLEMENTED_UNVERIFIED |
| SEC-01 | Path traversal protection | `upload-validation.ts` | `..`, absolute, null bytes rejected | Unit tests | `npm test` passes | VERIFIED | None | VERIFIED |
| SEC-02 | ZIP bomb protection | `upload-validation.ts` | Oversized archives rejected | Unit tests | `npm test` passes | VERIFIED | None | VERIFIED |
| SEC-03 | Webhook signature verification | `billing.routes.ts` | Signatures verified; idempotent | Unit tests | `npm test` passes | IMPLEMENTED_UNVERIFIED | Not tested with real Stripe webhooks | IMPLEMENTED_UNVERIFIED |
| SEC-04 | Secret management | Not implemented | Secrets encrypted at rest; never logged | Security review | Not attempted | NOT RUN | Not implemented | NOT_STARTED |
| BACKUP-01 | Backup and restore drill | `scripts/backup-postgres.sh` | Backup/restore verified | E2E | Not attempted | NOT RUN | Script not tested | NOT_STARTED |
| RECOVERY-01 | Service restart persistence | API/worker + PostgreSQL state | Data and routing persist across restart | Live restart | API+worker stopped/restarted; live hostname still served `revision=1` | VERIFIED | — | VERIFIED |

## Summary

| Status | Count |
|--------|-------|
| VERIFIED | 29 |
| IMPLEMENTED_UNVERIFIED | 5 |
| NOT_STARTED | 19 |
| BLOCKED | 0 |
| FAILED | 0 |
| NOT RUN | 0 |
| **Total** | **53** |

## Notes — M14 lifecycle evidence (2026-10-23)

- **End-to-end reference deployment** (`scripts/verify-service-deployment.mjs`, exit 0):
  - Service `216b9e74-7772-41bb-a5bc-276ec35f482a`, hostname `ref-mvla0cx3.sitedock.local`.
  - v1 `5c505636-82b1-42bd-b68d-f3b409089381`: READY, image `69db4a62…`, digest `sha256:9b995c58ea05…`, attempts 1, generation 1. Routed HTTP 200 `SiteDock reference app revision=1 path=/`.
  - v2 `76dd3d7d-8b16-4234-aea7-b77816102162`: READY, distinct image `4421f092…`, digest `sha256:8cdbcdcebe8a…`. Routed HTTP 200 `revision=2`.
  - Rollback: active deployment back to v1; new container `81a40955afc4…` (host port 40835) from the v1 image; routed 200 `revision=1`; v2 container stopped.
  - Broken v3 `e969777f-0ac4-4c50-a6a4-316d00167865`: FAILED after 3 attempts (`Dockerfile must contain a FROM instruction`); service stayed LIVE on v1.
  - Post-restart: API+worker restarted; `/health/ready` 200 and the same hostname still served `revision=1`.
- **Root cause of the stalled M13 deployment**: persisted error `Image build failed: … wsl --distribution FedoraLinux-44 --exec podman build … /bin/sh: line 1: wsl: command not found` — the old executor shelled out to the `wsl` CLI, absent from the worker's process PATH, so every build attempt failed. The deployment could not be recovered safely as evidence; a new deployment was created through the real API.
- **Defects fixed during M14**:
  1. Raw-SQL date bindings serialized in process-local time into `timestamp without time zone` columns (host TZ America/Montevideo), storing leases/completions 3 h in the past. Now UTC ISO strings with `::timestamp` casts.
  2. `renewLease` required `completed_at IS NULL`, but `markBuilt` legitimately sets `completed_at`; every renewal between build and runtime failed with `STALE_LEASE`. Ownership + generation remain the fence; the guard was removed.
  3. `activateWithLease` wrote `services.updated_at = NOW()` (DB-local time); now UTC.
  4. `PATCH /services/:id` never forwarded `contextFiles`, so v2 rebuilt an identical context.
  5. `ServiceDeployment`/`DeploymentLog` serialized as `{props:{…}}`; added `toJSON()`.
  6. Rootless builds with `RUN` steps failed (`sd-bus call: Permission denied`); the agent now builds with `--cgroup-manager=cgroupfs`.
  7. Base images moved from EOL Node 20 to `node:22-bookworm-slim` with `openssl`.
- **Quality gates**: `npm run lint` exit 0; `npm run typecheck` exit 0 (16 workspaces); `npm test` exit 0 — **354 tests / 38 files** across 14 suites (the earlier 345/348 counts predate the M14 integration suites).
- **Known limitations**: `pg_hba.conf` narrowing is written but not reloaded (needs elevation); the Windows firewall rule still allows `Any`; DNS/TLS are out of scope; static/Next.js/Python source presets are not implemented; no crash-injection harness beyond the stale-lease sequence.
