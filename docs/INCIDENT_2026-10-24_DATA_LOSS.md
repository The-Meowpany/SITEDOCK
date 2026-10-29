# Incident 2026-10-24 — development data loss from unscoped test cleanup

Status: **contained, recovery assessed, release hold in effect.**
Owner decision required before any reseed.

## 1. Summary

During M17 test-stabilisation work, cleanup code in a PostgreSQL integration suite ran
after that suite's setup had failed. Because Prisma treats `undefined` inside a `where`
clause as "no filter", `deleteMany({ where: { id: undefined } })` became an unscoped
`DELETE` and removed workspaces (and their dependent rows) from the **development**
schema (`public`) of the local `sitedock` database.

The test suites were running against the development schema at that moment because the
dedicated test database had only just been created and the connection was not yet
redirected.

## 2. Timeline (local time, UTC-03)

| Time | Event |
|---|---|
| 11:16 | Baseline probe: `public.workspaces = 40`; dedicated schema `sitedock_test` empty. |
| 11:17 | Integration run: the new guard rejected the connection (still `public`), so both `beforeAll` hooks failed. The worker suite's `afterAll` still executed with unset fixture ids and issued unscoped deletes. |
| 11:18 | Vitest `test.env` injection fixed: guard passed, suites ran in `sitedock_test`. Eight tests failed on a stale Prisma client (`column existe`) — unrelated to the deletion. |
| ~11:20 | Prisma client regenerated from the restored model; deployment suite 57/57 green. |
| 11:22 | First full-suite run: 362/362. |
| ~11:25–12:00 | Five consecutive full-suite runs: 362/362 each. |
| ~12:10 | `existe` column dropped via forward migration `0013`; drift check empty; `migrate status` clean. |
| ~14:00 | Post-run state probe found `public.workspaces = 0`; incident identified and reported. |
| ~14:15 | Preservation snapshot taken; destructive operations suspended. |

## 3. Root cause

Two defects combined:

1. **Unsafe cleanup shape.** `afterAll` used ids captured in `beforeAll`
   (`prisma.workspace.deleteMany({ where: { id: testWorkspaceId } })`, same for projects,
   services, deployments). When `beforeAll` throws, those ids are `undefined`. Prisma 5
   omits `undefined` filters, producing an unscoped delete. Verified empirically after the
   fact: `deleteMany({ where: { id: undefined } })` on a 2-row fixture returns
   `{ count: 2 }`.
2. **Unverified test target.** Integration suites used the shared `DATABASE_URL` default
   (`…/sitedock?schema=public`), i.e. the development schema, so the blast radius was real
   data rather than a throwaway namespace.

Aggravating factor: an earlier "pre-test cleanup" (`serviceDeployment.deleteMany({})`) had
already normalised unscoped deletes in these suites, which made the unsafe pattern look
acceptable.

## 4. Scope of loss

Verified facts:

- `public.workspaces`: **40 → 0** between the 11:16 probe and the post-incident probe.
- Surviving rows in `public`: `users` 19, `sessions` 43, `audit_logs` 81,
  `notifications` 19, `_prisma_migrations` 12. No other table holds rows.
- No orphaned children remain (`websites`, `clients`, `workspace_members`,
  `subscriptions`, `invoices`, `domains`, `website_backups`, `service*` all 0).
- `audit_logs` contains 38 distinct `WORKSPACE_CREATED` events (2026-10-23 02:37 →
  2026-10-24 01:45), which together with the 2 integration fixtures observed before the
  incident accounts for exactly 40 workspaces. List preserved at
  `backups/incident-2026-10-24/deleted-workspaces-from-audit.ndjson`.
- Cascades removed projects, services, service deployments, deployment logs, container
  instances and workspace members belonging to those workspaces.

Not verifiable (estimates only):

- Pre-incident row counts for `projects`, `services`, `service_deployments`,
  `container_instances`, `service_deployment_logs` were never sampled. PostgreSQL
  cumulative delete counters (`workspaces` 445, `projects` 431, `services` 424,
  `service_deployments` 1289) include every test cleanup since the server started on
  2026-10-19 and do not bound this incident.
- Content of the deleted workspaces (names beyond the slug pattern used by tests, project
  and service configuration, uploaded sites) cannot be reconstructed from surviving data.

## 5. Recovery assessment

| Source | Result |
|---|---|
| Logical dumps in the repo (`backups/`, `*.sql`, `*.dump`) | None existed before the incident. |
| `scripts/backup-postgres.sh` (cron + S3) | Never ran for this instance; it targets a container path `/backups` and requires Docker/Podman + cron. |
| WAL archiving / PITR | `archive_mode = off`, `archive_command = (disabled)`, `pg_stat_archiver.archived_count = 0`, `wal_keep_size = 0`. No archived WAL exists, so point-in-time recovery is not possible. |
| `pg_dump` / `pg_basebackup` / `psql` | Not installed on `PATH`; no manual dump could have been produced with them. |
| Container volume snapshot | Server is **native PostgreSQL 16.15 (Windows, Visual C++ build)**, not the compose container. Podman has no machine/connection configured, so no `sitedock_postgres_data` volume is reachable. |
| Current state | Preserved non-destructively (72 tables, 185 rows, SHA-256 manifest) under `backups/incident-2026-10-24/`. |

Conclusion: **no recoverable pre-incident copy is accessible from the application
environment.** This is substantiated by the absence of archives, dumps and container
snapshots — not inferred from the missing rows alone.

Still requiring the database owner (outside the project): Windows Volume Shadow Copy /
File History / OneDrive version history for the PostgreSQL data directory, and a
feasibility check for offline `pg_waldump` inspection of un-checkpointed segments after a
controlled shutdown. Neither has been attempted: both need filesystem access the
application role does not have.

## 6. Containment and preventive changes

- **Test target is verified, not assumed.** Integration suites run only against a
  dedicated schema; `SITEDOCK_TEST_DATABASE_URL` must equal `DATABASE_URL`, target a
  non-`public` schema, and the live connection must report that database and schema
  (`packages/database/src/test-database.ts`). The Vitest setup file applies it before any
  test module (and the PrismaClient) loads.
- **Provisioning is fail-closed.** `scripts/setup-test-database.mjs` refuses `public`,
  verifies the resolved namespace against the live server, and no longer passes
  `--accept-data-loss`.
- **Cleanup only deletes owned fixtures.** `deleteOwnFixtures()` drops any scope that
  contains an unassigned id, warns, and returns without issuing a query instead of falling
  back to an unscoped delete.
- **No global deletes in tests.** All `deleteMany({})` and global `updateMany` queue-resets
  were removed from the integration suites; stale fixture rows from interrupted runs are
  recovered only by workspace-slug prefix.
- **Regression tests** (`packages/deployment/src/__tests__/test-safety-boundary.test.ts`,
  11 cases) pin: failed setup ⇒ no delete calls; partial ids ⇒ only `in`-filtered deletes;
  unset/mismatched/public/production/unprovisioned targets ⇒ refusal; verified namespace ⇒
  accepted.

## 7. Verification after the changes

- Development schema fingerprint (row counts plus cumulative insert/update/delete
  counters for every `public` table) is identical before and after the integration
  suites and before/after five full-suite runs.
- Deployment package: 68/68 (57 prior + 11 regression tests).
- Full suite: 5 consecutive runs, 373/373 tests each (362 prior + 11 regression tests).
- `prisma migrate status`: 12 migrations, up to date. All 12 recorded checksums match the
  files on disk. `migrate diff public → model`: empty.

## 8. Open items and release hold

The hold stays until the owner documents one of:

1. a restored pre-incident copy (validated on an isolated instance before any replacement), or
2. an explicit decision that the data is unrecoverable and the development database may be
   reseeded (`npm run e2e` recreates demo data; it does not restore the lost workspaces).

Additional conditions:

- `docs/MIGRATION_BOOTSTRAP_REPAIR_PLAN.md` is approved and implemented before any
  environment without an existing database is provisioned.
- The 107 pre-existing TypeScript errors listed in the M17 report are resolved or
  explicitly waived; `apps/api` and `apps/worker` builds remain red until then.
- No test, script or job may target the `public` schema. `npm run e2e` and reseeding
  scripts remain suspended until the reseed decision is recorded.
