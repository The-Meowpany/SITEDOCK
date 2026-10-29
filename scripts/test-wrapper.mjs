#!/usr/bin/env node

/**
 * Test wrapper script for SiteDock.
 * 
 * This script ensures SITEDOCK_TEST_DATABASE_URL is set before running the root-level
 * test suite across all workspaces. Without this variable, integration tests will fail
 * with an accurate, actionable error from the test-database-guard module.
 * 
 * Usage: node scripts/test-wrapper.mjs
 * 
 * Environment:
 *   SITEDOCK_TEST_DATABASE_URL  PostgreSQL connection URL targeting a dedicated test
 *                               schema (e.g., postgresql://user:pass@host:5432/db?schema=sitedock_test).
 *                               Must not target the 'public' schema.
 * 
 * If SITEDOCK_TEST_DATABASE_URL is not set, the script prints an actionable error
 * explaining how to configure it, then exits with code 64 (USAGE_ERROR) so CI can
 * detect the missing configuration.
 */

const { execSync } = await import('node:child_process');
const { exit } = await import('node:process');

const testDatabaseUrl = process.env.SITEDOCK_TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  const envVars = [
    'SITEDOCK_API_URL',
    'SITEDOCK_API_TOKEN',
    'SITEDOCK_WORKSPACE_ID',
    'STRIPE_SECRET_KEY',
    'GITHUB_APP_ID',
    'GITHUB_APP_CLIENT_ID',
    'GITHUB_APP_CLIENT_SECRET',
    'GITHUB_APP_PRIVATE_KEY',
    'DNSHE_API_KEY',
    'DNSHE_API_SECRET',
  ].filter(v => process.env[v]).join(', ');
  const missingSitedock = envVars ? `and other env vars (${envVars})` : '';
  console.error(`
Error: SITEDOCK_TEST_DATABASE_URL is not set.

The root-level test suite requires a dedicated test database to run integration tests
safely. Without it, tests refuse to run against the development or production database.

To configure:
  export SITEDOCK_TEST_DATABASE_URL="postgresql://sitedock:sitedock@localhost:5432/sitedock?schema=sitedock_test"

This should point to a dedicated PostgreSQL schema (never the public schema that holds
application data). If you have PostgreSQL running locally with the sitedock database and
sitedock_test schema, use the URL above.

Other required env vars ${missingSitedock ? 'for full functionality' : ''}.

Exit code 64 indicates configuration needed; CI should treat this as a configured blocker,
not a test defect.

`);
  exit(64);
}

// Run the root test suite
try {
  execSync('npm run test --workspaces --if-present', { stdio: 'inherit' });
} catch (err) {
  exit(1);
}