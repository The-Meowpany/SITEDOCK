#!/usr/bin/env node

/**
 * Unit test runner - runs tests that do not require PostgreSQL.
 * This command does not require SITEDOCK_TEST_DATABASE_URL to be set.
 */

import { execSync } from 'node:child_process';
import { exit } from 'node:process';

// Run unit tests for packages/apps that don't require database
// These are typically pure logic tests
const unitWorkspaces = [
  'packages/shared',
  'packages/auth', 
  'packages/billing',
  'packages/domains',
  'packages/audit',
  'packages/dashboard',
  'packages/service',
  'packages/website',
  'packages/workspace',
  'packages/client',
  'packages/notification',
  'packages/maintenance',
  'packages/admin',
  'packages/github',
];

try {
  // Run tests only for unit workspaces
  const cmd = `npm run test --workspace=${unitWorkspaces.join(' --workspace=')} --if-present`;
  execSync(cmd, { stdio: 'inherit' });
  exit(0);
} catch (err) {
  exit(err.status || 1);
}
