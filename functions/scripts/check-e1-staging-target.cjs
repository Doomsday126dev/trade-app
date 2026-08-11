#!/usr/bin/env node
'use strict';

const { guardE1Target } = require('../staging/e1DeploymentGuard.cjs');

try {
  const result = guardE1Target({
    environment: process.env.APP_ENVIRONMENT,
    projectId: process.env.FIREBASE_PROJECT_ID,
    projectNumber: process.env.FIREBASE_PROJECT_NUMBER,
    expectedProjectNumber: process.env.EXPECTED_STAGING_PROJECT_NUMBER,
    serviceRegion: process.env.SERVICE_REGION,
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID,
    rtdbDatabaseUrl: process.env.RTDB_DATABASE_URL,
    serviceName: process.env.AUTHORITY_SERVICE_NAME,
    runtimeServiceAccount: process.env.AUTHORITY_RUNTIME_SERVICE_ACCOUNT,
    operationGates: {
      READ_ACCOUNT_FOUNDATION_ENABLED: process.env.READ_ACCOUNT_FOUNDATION_ENABLED,
      RESERVE_HANDLE_ENABLED: process.env.RESERVE_HANDLE_ENABLED,
      REPAIR_FOUNDATION_ENABLED: process.env.REPAIR_FOUNDATION_ENABLED,
      APPLY_MIGRATION_ENABLED: process.env.APPLY_MIGRATION_ENABLED,
      FREEZE_CONFLICT_ENABLED: process.env.FREEZE_CONFLICT_ENABLED
    }
  }, { allowedMutationGate: process.env.E1_ALLOWED_MUTATION_GATE || undefined });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, status: error.message, reasons: error.reasons || ['invalid_configuration'], cloudOperations: 0 }, null, 2)}\n`);
  process.exitCode = 1;
}
