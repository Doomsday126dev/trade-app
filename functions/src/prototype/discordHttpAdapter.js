'use strict';

const { fail } = require('../domain/errors');

const DEFAULT_TOKEN_ENDPOINT = 'https://discord.com/api/oauth2/token';
const DEFAULT_REVOKE_ENDPOINT = 'https://discord.com/api/oauth2/token/revoke';
const DEFAULT_USER_ENDPOINT = 'https://discord.com/api/v10/users/@me';

async function json(response, reason) {
  if (!response?.ok) fail('unavailable', reason);
  try { return await response.json(); } catch { fail('unavailable', reason); }
}

function basic(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')}`;
}

function createDiscordHttpAdapter({
  fetchImpl = globalThis.fetch,
  tokenEndpoint = DEFAULT_TOKEN_ENDPOINT,
  revokeEndpoint = DEFAULT_REVOKE_ENDPOINT,
  userEndpoint = DEFAULT_USER_ENDPOINT
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  async function exchangeCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    });
    const response = await fetchImpl(tokenEndpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: basic(clientId, clientSecret),
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: body.toString(),
      redirect: 'error'
    });
    const payload = await json(response, 'discord/token_exchange_failed');
    return Object.freeze({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type,
      scope: payload.scope,
      expiresIn: payload.expires_in
    });
  }

  async function getCurrentUser({ accessToken }) {
    const response = await fetchImpl(userEndpoint, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      redirect: 'error'
    });
    const payload = await json(response, 'discord/identity_lookup_failed');
    return Object.freeze({ subject: payload.id });
  }

  async function revokeToken({ clientId, clientSecret, token, tokenTypeHint }) {
    const response = await fetchImpl(revokeEndpoint, {
      method: 'POST',
      headers: {
        authorization: basic(clientId, clientSecret),
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ token, token_type_hint: tokenTypeHint }).toString(),
      redirect: 'error'
    });
    if (!response?.ok) fail('unavailable', 'discord/token_revoke_failed');
  }

  return Object.freeze({ exchangeCode, getCurrentUser, revokeToken });
}

module.exports = {
  DEFAULT_REVOKE_ENDPOINT,
  DEFAULT_TOKEN_ENDPOINT,
  DEFAULT_USER_ENDPOINT,
  createDiscordHttpAdapter
};
