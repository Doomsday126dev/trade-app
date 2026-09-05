'use strict';
const { fail } = require('./reset');

// The Admin SDK retries network/503 errors internally. A single native fetch to
// its documented accounts:update primitive prevents hidden credential replays.
function createPasswordUpdater({ projectId, credential, emulatorHost, fetchImpl = fetch }) {
  let origin = 'https://identitytoolkit.googleapis.com';
  if (emulatorHost) {
    if (!/^demo-[a-z0-9-]+$/.test(projectId) || !/^127\.0\.0\.1:[0-9]+$/.test(emulatorHost)) fail('reset/configuration');
    origin = `http://${emulatorHost}/identitytoolkit.googleapis.com`;
  } else if (projectId !== 'trade-list-a4297') fail('reset/configuration');
  return async (uid, pin) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || typeof pin !== 'string' || !/^[0-9]{6}$/.test(pin)) fail('reset/invalid-request');
    const token = emulatorHost ? 'owner' : (await credential.getAccessToken()).access_token;
    const response = await fetchImpl(`${origin}/v1/projects/${projectId}/accounts:update`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, password: pin })
    });
    if (!response.ok) { await response.body?.cancel(); fail('reset/auth-update-unconfirmed'); }
    const result = await response.json();
    if (result.localId !== uid) fail('reset/auth-update-unconfirmed');
  };
}
module.exports = { createPasswordUpdater };
