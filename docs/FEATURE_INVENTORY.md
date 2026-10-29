# SiteDock Feature Inventory

Single source of truth for what is actually implemented, what is verified, and
what is still missing. Status is deliberately conservative.

Last updated: 2026-10-28

## Status legend

- **Ready** — implemented, typechecked, covered by tests and/or verified end to end.
- **Implemented** — code exists and typechecks, but live-provider verification is pending.
- **Partial** — main path exists; a material part of the workflow is still missing.
- **Missing** — not implemented.

## Core platform

| Feature | Status | Notes |
| --- | --- | --- |
| Multi-tenant workspaces, members, roles | Ready | OWNER / ADMIN / DEVELOPER / CLIENT with fail-closed authorization middleware. |
| Authentication, sessions, logout, password reset | Ready | Argon2 hashing, hashed session tokens, suspended-account revalidation. |
| Website lifecycle (draft → approval → published) | Ready | State machine plus rollback to prior deployments. |
| ZIP deployment upload and static publishing | Ready | Deployment versions, production pointer, `/sites/<subdomain>` delivery. |
| Client portal | Ready | Client-scoped website access and maintenance requests. |
| Maintenance request workflow | Ready | Quote, start, complete, approve, mark paid, quota accounting. |
| Recurring billing (hosting / maintenance) | Ready | Plans, subscriptions, checkout links, allowance. |
| One-time charges | Ready | Project charges and checkout links. |
| Stripe webhook ingestion | Ready | Raw-body signature verification and idempotent event ledger. |
| Backup and restore | Ready | Integrity hash, retention, source-deployment link. |
| Audit log | Ready | Domain, GitHub, API-token and admin actions included. |
| Admin console | Ready | Users, tenants, sites, payments, webhook ledger, DNSHE operations. |
| Rate limiting and security headers | Ready | Auth and public endpoints covered. |
| Dynamic services and runtime instances | Ready | Build context, active deployment, host-port proxying, health gating. |
| Preview deployments (GitHub pull requests) | Implemented | Revision model and preview routing exist; GitHub App e2e blocked by credentials. |

## Custom domains and TLS

| Feature | Status | Notes |
| --- | --- | --- |
| Domain model and lifecycle | Ready | Pending / verifying / verified / failed, routing and SSL metadata. |
| Register domain for website or service | Ready | `POST /api/v1/workspaces/:w/websites/:s/domains`. |
| Ownership TXT challenge | Ready | `_sitedock-verify.<host>` = `sitedock-verification=<token>`. |
| DoH ownership and routing checks | Ready | Cloudflare and Google resolvers, fail-closed on lookup errors. |
| DNSHE V2 client | Implemented | Header auth, timeout/error mapping, no secrets in URLs. Live run blocked by missing credentials. |
| Managed DNSHE provider | Implemented | Auto TXT provisioning, routing instructions, conflict-safe writes, base A record dry-run/apply. |
| Verify / re-check domain use cases | Ready | Preserves verified state on transient DNS/TLS failures. |
| TLS certificate probing | Ready | Node TLS probe checks served certificate and expiry. |
| Caddy on-demand TLS authorization | Implemented | `/internal/tls/ask` with shared secret; Caddy config not executed locally. |
| Wildcard routing for platform hostnames | Implemented | Control hosts, services, websites and previews; requires public IP and DNS. |
| SSL expiry notification job | Ready | Worker selects DNSHE provider when configured. |
| Admin DNSHE status and provisioning UI | Ready | `/api/v1/admin/dns/*` plus Admin console section. |
| Live DNSHE verification | Blocked | Missing `DNSHE_API_KEY`, `DNSHE_API_SECRET`, `SITEDOCK_PUBLIC_IP`. |

## GitHub integration

| Feature | Status | Notes |
| --- | --- | --- |
| GitHub App JWT and installation tokens | Ready | Private key stays server-side. |
| Repository listing through an installation | Ready | `GET /workspaces/:ws/websites/:websiteId/github/repositories`, OWNER/ADMIN/DEVELOPER. |
| Repository connection persistence | Ready | Website-scoped, unique by installation + repository, verified via GitHub API. |
| Dashboard connect flow | Ready | Install link, installation callback, repo/service selection, disconnect. |
| Webhook signature verification | Ready | Raw body HMAC, constant-time compare. |
| Push to default branch → production deployment | Implemented | Requires a persisted connection and valid GitHub App credentials. |
| Pull request → preview deployment | Implemented | Contract and enqueue path exist; live GitHub e2e pending. |
| Live GitHub App verification | Blocked | Missing App credentials and public webhook URL. |

## API / CLI / operations

| Feature | Status | Notes |
| --- | --- | --- |
| Versioned REST API | Ready | `/api/v1`, typed error envelope, audit hooks. |
| API tokens for machine access | Ready | Hashed `sitedock_pat_...` tokens, read/write scopes, expiry, revocation and workspace confinement. |
| Dashboard token management | Ready | Workspace `/settings` page creates, copies and revokes tokens; OWNER/ADMIN only. |
| CLI | Ready | `@sitedock/cli` (`sitedock`) for whoami, workspaces, sites, domains and ZIP deploys. |
| Migration verifier safety suite | Ready | `node scripts/verify-migrations.mjs --self-test` passes 14 checks. |
| Greenfield migration run | Ready | Isolated schema run passed: 40 tables, 27 enums, 124 indexes, 93 constraints; second deploy is a no-op. |
| Production compose / Caddy config | Implemented | Env-driven; no Docker/Caddy available to execute syntax checks. |
| Staging Caddyfile | Ready | Env-driven hosts, shared TLS ask policy. |
| Deploy/TLS scripts | Ready | Domain values come from `SITEDOCK_BASE_DOMAIN`; DNSHE required when provider is dnshe. |
| Feature inventory | Ready | This document. |

## Verification snapshot

- `npm run typecheck` — all workspaces pass.
- `npm run lint` — passes.
- `@sitedock/domains` — 25 tests pass (domain lifecycle, DNSHE, TLS/renewal).
- `@sitedock/github` — 10 tests pass.
- `@sitedock/api` — 92 tests pass, including API-token guard tests.
- Full `npm run test` — 423 tests pass across all workspaces (integration tests
  included, with `SITEDOCK_TEST_DATABASE_URL` set).
- Migration safety self-test — 14/14 checks pass.
- Greenfield migration chain — passes in an isolated `sitedock_migtest_*` schema.
- Not verified: live DNSHE operations, public HTTPS/wildcard issuance, GitHub App
  installation/webhooks, Docker image build, Caddyfile execution.

## Highest-value remaining work

1. Apply `0018_custom_domain_lifecycle` / `0019_api_tokens` to staging and run
   the reconciliation verifier there.
2. Provide DNSHE credentials and a public edge IP; verify TXT, CNAME/A routing,
   on-demand certificates and expiry notifications end to end.
3. Configure the GitHub App and public webhook URL; verify push and pull-request
   flows against a real repository.
4. Execute Docker/Caddy config validation in a staging host.
