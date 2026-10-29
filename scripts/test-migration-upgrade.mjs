#!/usr/bin/env node
/**
 * Migration upgrade compatibility test
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = path.join(root, 'packages/database');
const schemaPath = path.join(dbDir, 'prisma/schema.prisma');
const migrationsDir = path.join(dbDir, 'prisma/migrations');

const ADMIN_URL_ENV = process.env.SITEDOCK_MIGRATION_TEST_ADMIN_URL || process.env.SITEDOCK_TEST_DATABASE_URL;

if (!ADMIN_URL_ENV) {
  console.error('Error: Need SITEDOCK_MIGRATION_TEST_ADMIN_URL or SITEDOCK_TEST_DATABASE_URL');
  process.exit(1);
}

const schema = `sitedock_migup_${crypto.randomBytes(4).toString('hex')}`;

const testUrl = new URL(ADMIN_URL_ENV);
testUrl.searchParams.set('schema', schema);
const testUrlStr = testUrl.toString();

const adminUrl = new URL(ADMIN_URL_ENV);
adminUrl.searchParams.set('schema', 'public');
const adminUrlStr = adminUrl.toString();

console.log(`[mig-upgrade] Creating schema ${schema}`);

const adminClient = new PrismaClient({ datasources: { db: { url: adminUrlStr } } });

try {
  await adminClient.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
} catch (e) {
  console.error('Failed to create schema:', e.message);
  process.exit(1);
} finally {
  await adminClient.$disconnect();
}

console.log(`[mig-upgrade] Applying migrations from packages/database...`);
const deploy = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schemaPath], {
  cwd: dbDir,
  env: { ...process.env, DATABASE_URL: testUrlStr },
  stdio: 'inherit'
});

if (deploy.status !== 0) {
  console.error('[mig-upgrade] Migration deploy failed');
  process.exit(deploy.status || 1);
}

const migrations = fs.readdirSync(migrationsDir).filter(f => !f.startsWith('.'));
console.log('[mig-upgrade] Migration count:', migrations.length);
console.log('[mig-upgrade] Migrations applied successfully');

// Cleanup
const cleanup = new PrismaClient({ datasources: { db: { url: adminUrlStr } } });
try {
  await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  console.log('[mig-upgrade] Cleaned up schema');
} catch (e) {
  console.error('Cleanup failed:', e.message);
} finally {
  await cleanup.$disconnect();
}

console.log('[mig-upgrade] Test completed successfully');
process.exit(0);
