'use strict';
// The entire persistent event is these two finite, allowlisted fields. Never
// pass SDK messages, objects, request context or identifiers to the emitter.
const OPERATIONS = Object.freeze([
  'initialization', 'auth-verification', 'app-check-verification',
  'app-check-replay-create', 'quota-metadata-read', 'quota-generation-read',
  'quota-compare-and-swap', 'identity-scalar-read', 'identity-fence-read',
  'request', 'quota-release'
]);
const STATUSES = Object.freeze([400, 401, 403, 404, 408, 409, 412, 429, 500, 502, 503, 504]);
function dependencyStatus(error) {
  try {
    const value = error?.code;
    return STATUSES.find(code => value === code || value === String(code)) || 0;
  } catch { return 0; }
}
function createFailureDiagnostics(emit = event => console.warn(JSON.stringify(event))) {
  const reported = new WeakSet();
  function report(operation, error) {
    try {
      if (!OPERATIONS.includes(operation)) return;
      const reference = error !== null && (typeof error === 'object' || typeof error === 'function');
      if (reference && reported.has(error)) return;
      if (reference) reported.add(error);
      emit(Object.freeze({ operation, dependencyStatus: dependencyStatus(error) }));
    } catch { /* Diagnostic failures must never change resolver behavior. */ }
  }
  async function observe(operation, work) {
    try { return await work(); }
    catch (error) { report(operation, error); throw error; }
  }
  return Object.freeze({ report, observe });
}
module.exports = { OPERATIONS, STATUSES, dependencyStatus, createFailureDiagnostics };
