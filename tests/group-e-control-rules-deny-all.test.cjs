'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  API_KEY_ENV,
  CONFIRMATION,
  PROBE_PATH,
  run,
  sanitizedFailure,
  validateProbePath,
  verifyProduction
} = require('../scripts/verify-group-e-control-rules-deny-all.cjs');

const INDEX_SOURCE = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const API_KEY = INDEX_SOURCE.match(/apiKey:'([^']+)'/u)?.[1];
const ARGS = [
  '--mode=production-verify',
  '--project=trade-list-a4297',
  '--database=e1-group-e-control',
  '--expected-empty=true',
  `--confirm=${CONFIRMATION}`
];

function response(status, errorClass, { reason, message } = {}) {
  return {
    status,
    async json() {
      return errorClass === null ? {} : {
        error: {
          status: errorClass,
          ...(message ? { message } : {}),
          ...(reason ? { details: [{
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason,
            domain: 'googleapis.com',
            metadata: { private: 'must not escape' }
          }] } : {})
        }
      };
    }
  };
}

async function rejectionDiagnostic(promise) {
  try {
    await promise;
    assert.fail('expected verifier rejection');
  } catch (error) {
    return { error, diagnostic: sanitizedFailure(error) };
  }
}

test('default plan mode is inert and requires no key or network adapter', async () => {
  let calls = 0;
  const result = await run([], {}, { fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  assert.equal(calls, 0);
  assert.equal(result.mode, 'plan');
  assert.equal(result.networkRequests, 0);
  assert.equal(result.probePath, PROBE_PATH);
  assert.equal(result.updatePrecondition, 'currentDocument.exists=true');
  assert.equal(result.documentsCreatedByDesign, 0);
});

test('probe path is fixed to two valid Firestore segments and rejects reserved or malformed paths', () => {
  assert.equal(PROBE_PATH, 'group-e-rules-probe/deny-all');
  assert.equal(validateProbePath(PROBE_PATH), PROBE_PATH);
  for (const invalid of [
    '__group_e_rules_probe__/deny-all', '', 'one-segment', 'one/two/three', './deny-all',
    '../deny-all', 'group-e-rules-probe/.', 'group-e-rules-probe/..', 'group-e-rules-probe/__deny__'
  ]) {
    assert.throws(() => validateProbePath(invalid), /group_e_control_rules_verifier_probe_path_invalid/);
  }
});

test('production verifier uses exact unauthenticated GET and non-creating existing-document PATCH', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return response(403, 'PERMISSION_DENIED');
  };
  const result = await run(ARGS, {
    [API_KEY_ENV]: API_KEY,
    GOOGLE_APPLICATION_CREDENTIALS: '/must/not/be/read.json',
    FIREBASE_TOKEN: 'must-not-be-used'
  }, { fetchImpl });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.origin, 'https://firestore.googleapis.com');
  assert.equal(calls[0].url.pathname,
    '/v1/projects/trade-list-a4297/databases/e1-group-e-control/documents/group-e-rules-probe/deny-all');
  assert.equal(calls[1].url.pathname, calls[0].url.pathname);
  assert.equal(calls[0].url.searchParams.get('key'), API_KEY);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'PATCH');
  assert.equal(calls[1].url.searchParams.get('currentDocument.exists'), 'true');
  assert.deepEqual(JSON.parse(calls[1].init.body), { fields: { probe: { booleanValue: true } } });
  for (const call of calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(Object.keys(call.init.headers).some((name) => /authorization|cookie/iu.test(name)), false);
  }
  assert.deepEqual(result.read, { httpStatus: 403, errorClass: 'PERMISSION_DENIED' });
  assert.deepEqual(result.update, { httpStatus: 403, errorClass: 'PERMISSION_DENIED' });
  assert.equal(result.readDenied, true);
  assert.equal(result.updateDenied, true);
  assert.equal(result.documentsCreatedByDesign, 0);
  assert.deepEqual(Object.keys(result).sort(), [
    'credentialsPersisted', 'database', 'documentsCreatedByDesign', 'probePath', 'project',
    'read', 'readDenied', 'update', 'updateDenied'
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(API_KEY, 'u'));
});

test('verifier rejects alternate targets credentials on command line and malformed production authority', async () => {
  const invalidArguments = [
    ARGS.map((value) => value === '--project=trade-list-a4297' ? '--project=other' : value),
    ARGS.map((value) => value === '--database=e1-group-e-control' ? '--database=phase-e-identity' : value),
    [...ARGS, '--host=example.com'],
    [...ARGS, `--api-key=${API_KEY}`],
    ARGS.filter((value) => !value.startsWith('--confirm=')),
    ARGS.map((value) => value.startsWith('--confirm=') ? '--confirm=wrong' : value)
  ];
  for (const argv of invalidArguments) {
    await assert.rejects(run(argv, { [API_KEY_ENV]: API_KEY }, { fetchImpl: async () => response(403, 'PERMISSION_DENIED') }),
      /group_e_control_rules_verifier_arguments_invalid/);
  }
  await assert.rejects(run(ARGS, {}, { fetchImpl: async () => response(403, 'PERMISSION_DENIED') }),
    /group_e_control_rules_verifier_api_key_invalid/);
  await assert.rejects(run(ARGS, { [API_KEY_ENV]: 'wrong_public_web_api_key_12345' }, {
    fetchImpl: async () => response(403, 'PERMISSION_DENIED')
  }), /group_e_control_rules_verifier_api_key_invalid/);
});

test('403 permission denial is the only accepted result and failures are terminal without retries', async () => {
  for (const [status, errorClass, expected] of [
    [200, null, /group_e_control_rules_verifier_not_denied/],
    [404, 'NOT_FOUND', /group_e_control_rules_verifier_not_found/],
    [401, 'UNAUTHENTICATED', /group_e_control_rules_verifier_not_denied/]
  ]) {
    let calls = 0;
    await assert.rejects(verifyProduction({ apiKey: API_KEY, fetchImpl: async () => {
      calls += 1;
      return response(status, errorClass);
    } }), expected);
    assert.equal(calls, 1);
  }

  let updateCalls = 0;
  await assert.rejects(verifyProduction({ apiKey: API_KEY, fetchImpl: async () => {
    updateCalls += 1;
    return updateCalls === 1 ? response(403, 'PERMISSION_DENIED') : response(412, 'FAILED_PRECONDITION');
  } }), /group_e_control_rules_verifier_precondition_allowed/);
  assert.equal(updateCalls, 2);
});

test('HTTP failures expose only bounded phase-aware sanitized diagnostics', async () => {
  for (const [status, errorClass] of [[400, 'INVALID_ARGUMENT'], [401, 'UNAUTHENTICATED']]) {
    let calls = 0;
    const { error, diagnostic } = await rejectionDiagnostic(verifyProduction({
      apiKey: API_KEY,
      fetchImpl: async () => {
        calls += 1;
        return response(status, errorClass, {
          reason: status === 400 ? 'INVALID_ARGUMENT' : 'AUTH_CREDENTIALS_INVALID',
          message: `raw private error contains ${API_KEY}`
        });
      }
    }));
    assert.match(error.message, /group_e_control_rules_verifier_not_denied/);
    assert.equal(calls, 1);
    assert.deepEqual(diagnostic, {
      verifierErrorCode: 'group_e_control_rules_verifier_not_denied',
      httpStatus: status,
      googleErrorStatus: errorClass,
      errorInfoReasons: [status === 400 ? 'INVALID_ARGUMENT' : 'AUTH_CREDENTIALS_INVALID'],
      requestPhase: 'read',
      credentialsPersisted: 0,
      documentsCreatedByDesign: 0
    });
    const output = JSON.stringify(diagnostic);
    assert.doesNotMatch(output, new RegExp(API_KEY, 'u'));
    assert.doesNotMatch(output, /raw private error|must not escape/iu);
  }
});

test('infrastructure-originated 403 permission denials fail closed instead of proving Rules', async () => {
  let calls = 0;
  const { error, diagnostic } = await rejectionDiagnostic(verifyProduction({
    apiKey: API_KEY,
    fetchImpl: async () => {
      calls += 1;
      return response(403, 'PERMISSION_DENIED', {
        reason: 'API_KEY_HTTP_REFERRER_BLOCKED',
        message: `blocked key ${API_KEY}`
      });
    }
  }));
  assert.match(error.message, /group_e_control_rules_verifier_infrastructure_denied/);
  assert.equal(calls, 1);
  assert.deepEqual(diagnostic, {
    verifierErrorCode: 'group_e_control_rules_verifier_infrastructure_denied',
    httpStatus: 403,
    googleErrorStatus: 'PERMISSION_DENIED',
    errorInfoReasons: ['API_KEY_HTTP_REFERRER_BLOCKED'],
    requestPhase: 'read',
    credentialsPersisted: 0,
    documentsCreatedByDesign: 0
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), new RegExp(API_KEY, 'u'));
});

test('network errors malformed responses and bounded timeout fail without retry', async () => {
  let networkCalls = 0;
  await assert.rejects(verifyProduction({ apiKey: API_KEY, fetchImpl: async () => {
    networkCalls += 1;
    throw new Error('private detail must not escape');
  } }), /group_e_control_rules_verifier_network_failed/);
  assert.equal(networkCalls, 1);

  await assert.rejects(verifyProduction({ apiKey: API_KEY, fetchImpl: async () => ({
    status: 403, async json() { throw new Error('bad'); }
  }) }), /group_e_control_rules_verifier_response_malformed/);

  let bodyCalls = 0;
  await assert.rejects(verifyProduction({ apiKey: API_KEY, timeoutMs: 5, fetchImpl: async () => {
    bodyCalls += 1;
    return { status: 403, json() { return new Promise(() => {}); } };
  } }), /group_e_control_rules_verifier_timeout/);
  assert.equal(bodyCalls, 1);

  let timeoutCalls = 0;
  await assert.rejects(verifyProduction({ apiKey: API_KEY, timeoutMs: 5, fetchImpl: async (_url, init) => {
    timeoutCalls += 1;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true }));
  } }), /group_e_control_rules_verifier_timeout/);
  assert.equal(timeoutCalls, 1);
});

test('verifier source has no privileged client credential header create delete list query or redirect capability', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/verify-group-e-control-rules-deny-all.cjs'), 'utf8');
  assert.doesNotMatch(source, /firebase-admin|@google-cloud\/firestore|google-auth-library|applicationDefault|getAccessToken/iu);
  assert.doesNotMatch(source, /method:\s*['"](?:POST|DELETE)['"]/u);
  assert.doesNotMatch(source, /createDocument|setDoc|addDoc|runQuery|listCollection/iu);
  assert.match(source, /currentDocument\.exists/u);
  assert.match(source, /redirect:\s*'error'/u);
});
