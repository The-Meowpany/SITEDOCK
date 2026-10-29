# Migration bootstrap repair plan (proposal — superseded by the implemented repair)

Status: **proposal kept for the decision record; superseded on 2026-10-24**.
The repair that shipped does not follow this plan's recommended option 4: a
baseline plus `prisma migrate resolve` requires manual migration-history entries,
which Scenario A of the repair brief forbids. The chosen strategy is two
idempotent, forward-only repair migrations (`0006_organization_domain_repair`,
`0014_reconcile_model_drift`) that make the existing chain self-sufficient.
See `docs/MIGRATION_BOOTSTRAP_REPAIR_REPORT.md` for the evidence and results.
No migration has been rewritten, squashed or replayed against an existing
database under either document.

## Problem

A blank PostgreSQL database cannot be built from `packages/database/prisma/migrations`.

Evidence (2026-10-24):

- A fresh schema, migrated with `prisma migrate deploy`, applied `0001`–`0011` and then
  failed:

  ```
  Migration name: 0012_add_environment_and_roles
  Database error code: 42704
  Database error: ERROR: type "OrganizationRole" does not exist
  ```

  `0012` contains `ALTER TYPE "OrganizationRole" ADD VALUE ...`, but no migration in the
  repository creates that enum, nor the `organizations`, `organization_members` or
  `account_organizations` tables that reference it.
- The directory listing has a gap: `0001`–`0005`, **no `0006`**, `0007`–`0013`.
- `public` contains 36 tables and 25 enums. Four of those tables (`organizations`,
  `organization_members`, `account_organizations`, plus `_prisma_migrations` itself) and
  the `OrganizationRole` enum are not created by any migration file. They were created by
  `prisma db push`.
- In `public._prisma_migrations`, `0012_add_environment_and_roles` is recorded as applied
  with `applied_steps_count = 0`, i.e. it was marked applied (`migrate resolve`) rather
  than executed. The objects it would have created exist only because of `db push`.
- All 12 recorded checksums match the current files, so no applied migration was edited
  after the fact.

## Constraints

- Do not rewrite applied migrations, reset production-like data, or use
  `prisma db push --accept-data-loss`.
- Existing databases (`public`, `sitedock_test`) must keep working without re-running
  anything.
- The fix must be provable by a reproducible blank-database migration test in CI.

## Options considered

1. **Restore the lost `0006` migration.** Impossible to do faithfully: its content is not
   in the repository or git history, and inserting a migration before `0012` would make
   `0012` "already applied before" on every existing database.
2. **Squash everything into a new baseline.** Rewrites history and requires `migrate
   resolve --applied` on every existing environment; high blast radius, explicitly out of
   bounds.
3. **Forward "reconciliation" migration that creates the missing objects.**
   `CREATE TYPE ... IF NOT EXISTS` style SQL is not supported for enums on PostgreSQL;
   duplicate-object errors would still break fresh deploys, and ordering (`0012` runs
   first) cannot be fixed by appending.
4. **Versioned baseline added ahead of the broken chain** (recommended): leave
   `0001`–`0013` untouched and introduce a *new, separate* baseline migration directory
   used only for greenfield databases, plus a documented `migrate resolve` step for
   existing ones.

## Recommended plan (not started)

1. Generate a baseline from the current, drift-free model:
   `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
   and commit it as `migrations/0000_baseline/migration.sql` **only after** review.
   Because Prisma applies migrations in lexical order, `0000_baseline` would run before
   `0001` and fail on existing objects — therefore the baseline must live in a separate
   directory (e.g. `prisma/baseline/`) referenced by a second Prisma schema variant, or
   the release must start a new `migrations_v2` history. This decision needs an owner
   sign-off because it changes how deployments choose their migration set.
2. Add an explicit, reviewed script that provisions a greenfield database from the
   baseline and then records `0001`–`0013` as applied via `prisma migrate resolve` where
   their effects are already covered by the baseline.
3. Add a CI job that creates an empty database/schema, runs the chosen bootstrap path,
   then asserts `prisma migrate status` is clean **and**
   `prisma migrate diff --from-url <fresh> --to-schema-datamodel schema.prisma --exit-code`
   returns 0.
4. Only then raise `prisma/migrations` to a reproducible state; until that CI job is green,
   the migration chain must be considered unhealthy in the acceptance matrix.

## Interim rules (in force now)

- Integration tests do not use `prisma migrate deploy` for provisioning. They use the
  guarded `npm run db:test:setup`, which reconciles a dedicated, non-`public` schema from
  the model and never passes `--accept-data-loss`.
- Any new schema change ships as a forward migration (`0014+`) and is validated with
  `prisma migrate status` + `prisma migrate diff` against `public`.
- Fresh-database bootstrap is a known open defect and is tracked as a release blocker for
  any environment that has no existing database.
