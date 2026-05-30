#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    fail(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function extractFunctionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(html);
  assert(match, `Missing function ${name} in index.html`);

  const start = match.index;
  const paramsStart = html.indexOf('(', start);
  assert(paramsStart !== -1, `Could not find parameter list for ${name}`);

  let parenDepth = 0;
  let paramsEnd = -1;
  for (let i = paramsStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        paramsEnd = i;
        break;
      }
    }
  }

  assert(paramsEnd !== -1, `Could not find end of parameter list for ${name}`);

  const braceStart = html.indexOf('{', paramsEnd);
  assert(braceStart !== -1, `Could not find function body for ${name}`);

  let depth = 0;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  fail(`Could not extract complete function body for ${name}`);
}

function assertSourceIncludes(source, snippet, message) {
  assert(source.includes(snippet), `${message}: missing ${snippet}`);
}

function runSourceWiringChecks() {
  const approveRequest = extractFunctionSource('approveRequest');
  const createMemberNow = extractFunctionSource('createMemberNow');
  const repairMemberAccount = extractFunctionSource('repairMemberAccount');
  const defaultCommunityMembershipUpdates = extractFunctionSource('defaultCommunityMembershipUpdates');
  const validateNonDefaultCommunityId = extractFunctionSource('validateNonDefaultCommunityId');
  const buildNonDefaultCommunityPreparation = extractFunctionSource('buildNonDefaultCommunityPreparation');
  const prepareNonDefaultCommunity = extractFunctionSource('prepareNonDefaultCommunity');
  const recordCommunityId = extractFunctionSource('recordCommunityId');

  assertSourceIncludes(
    approveRequest,
    'await createMemberNow(username,pin,false,reqId);',
    'approveRequest must route approvals through createMemberNow(username, pin, false, reqId)'
  );

  assertSourceIncludes(
    createMemberNow,
    'defaultCommunityMembershipUpdates(username,user,user.joined)',
    'createMemberNow must write default community membership updates'
  );

  assertSourceIncludes(
    repairMemberAccount,
    'defaultCommunityMembershipUpdates(username,next,next.joined||Date.now())',
    'repairMemberAccount must repair default community membership updates'
  );

  assertSourceIncludes(
    defaultCommunityMembershipUpdates,
    'communities/${DEFAULT_COMMUNITY_ID}/memberUsernames/${username}',
    'defaultCommunityMembershipUpdates must write community memberUsernames index'
  );
  assertSourceIncludes(
    defaultCommunityMembershipUpdates,
    'communities/${DEFAULT_COMMUNITY_ID}/members/${uid}',
    'defaultCommunityMembershipUpdates must write community members index'
  );
  assertSourceIncludes(
    defaultCommunityMembershipUpdates,
    'userCommunities/${uid}/${DEFAULT_COMMUNITY_ID}',
    'defaultCommunityMembershipUpdates must write userCommunities reverse index'
  );

  assertSourceIncludes(
    createMemberNow,
    'communities/${DEFAULT_COMMUNITY_ID}/memberUsernames/${username}',
    'createMemberNow must verify the default community memberUsernames index after update'
  );
  assertSourceIncludes(
    createMemberNow,
    'shouldWriteDefaultCommunity&&!communitySnap.exists()',
    'createMemberNow must fail verification if the default community index was not written'
  );

  assertSourceIncludes(
    recordCommunityId,
    'record?.communityId||DEFAULT_COMMUNITY_ID',
    'recordCommunityId must default missing or blank communityId to DEFAULT_COMMUNITY_ID'
  );

  assert(
    /\bconst\s+MULTI_COMMUNITY_ENABLED\s*=\s*false\s*;/.test(html),
    'MULTI_COMMUNITY_ENABLED must remain false for current production behavior'
  );
  assert(
    /\bconst\s+DEFAULT_COMMUNITY_ID\s*=\s*'nyc'\s*;/.test(html),
    "DEFAULT_COMMUNITY_ID must remain 'nyc'"
  );
  assertSourceIncludes(
    validateNonDefaultCommunityId,
    'if(id===DEFAULT_COMMUNITY_ID)',
    'non-default community validator must reject the default NYC id'
  );
  assertSourceIncludes(
    validateNonDefaultCommunityId,
    '/[.#$\\[\\]\\/]/',
    'non-default community validator must reject Firebase-forbidden key characters'
  );
  assertSourceIncludes(
    validateNonDefaultCommunityId,
    '/^[a-z0-9-]+$/',
    'non-default community validator must use conservative lowercase id pattern'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityPreparation,
    'communities/${id}',
    'non-default community prep must write the community record path'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityPreparation,
    'userCommunities/${ownerUid}/${id}',
    'non-default community prep must write the owner reverse-index path'
  );
  assertSourceIncludes(
    prepareNonDefaultCommunity,
    'ownerCanUseCommunityTools()',
    'non-default community prep action must be function-level owner guarded'
  );
  assert(
    !prepareNonDefaultCommunity.includes('setCurrentCommunityId('),
    'non-default community prep must not switch the selected community'
  );
}

function runBehaviorChecks() {
  const sandbox = {
    Date,
    OWNER: 'Doomsday126',
    DEFAULT_COMMUNITY_ID: 'nyc',
    COMMUNITY_VISIBILITIES: ['private', 'inviteOnly', 'public'],
    MULTI_COMMUNITY_ENABLED: false,
    SELECTED_COMMUNITY_KEY: 'selectedCommunityId',
    currentAuthUid: 'auth-admin',
    cur: 'AdminUser',
    allData: {
      users: {
        AdminUser: { isAdmin: true },
        OwnerUser: { authUid: 'uid-owner', isOwner: true, joined: 777 },
        Alpha: {},
        Beta: {}
      },
      communities: {
        nyc: {
          memberUsernames: { Alpha: true },
          members: { 'uid-alpha': true },
          admins: {}
        }
      }
    },
    lsGet(_key, fallback) {
      return fallback;
    },
    normalizeCommunityId(value) {
      return String(value || '').trim().toLowerCase() || 'nyc';
    },
    normalizedUserRecord(username, userRecord = {}, extra = {}) {
      return { username, ...userRecord, ...extra };
    },
    communityRoleForUser(_username, userRecord = {}) {
      if (userRecord.isOwner) return 'owner';
      if (userRecord.isAdmin) return 'admin';
      return 'member';
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    [
      extractFunctionSource('defaultCommunityMembershipUpdates'),
      extractFunctionSource('validateNonDefaultCommunityId'),
      extractFunctionSource('normalizeCommunityRecord'),
      extractFunctionSource('buildNonDefaultCommunityPreparation'),
      extractFunctionSource('getCurrentCommunityId'),
      extractFunctionSource('getCommunityMemberUsernames'),
      extractFunctionSource('isUserInCommunity'),
      extractFunctionSource('filterUsersBySelectedCommunity'),
      extractFunctionSource('canManageCommunity'),
      extractFunctionSource('recordCommunityId')
    ].join('\n'),
    sandbox
  );

  const memberUpdates = sandbox.defaultCommunityMembershipUpdates(
    'NewMember',
    { authUid: 'uid-new', joined: 1234 },
    9999
  );
  assertEqual(
    memberUpdates['communities/nyc/memberUsernames/NewMember'],
    true,
    'defaultCommunityMembershipUpdates writes memberUsernames path'
  );
  assertEqual(
    memberUpdates['communities/nyc/members/uid-new'],
    true,
    'defaultCommunityMembershipUpdates writes members path'
  );
  assertDeepEqual(
    memberUpdates['userCommunities/uid-new/nyc'],
    { role: 'member', username: 'NewMember', joinedAt: 1234 },
    'defaultCommunityMembershipUpdates writes reverse index payload'
  );
  assert(
    !Object.prototype.hasOwnProperty.call(memberUpdates, 'communities/nyc/admins/uid-new'),
    'defaultCommunityMembershipUpdates does not promote regular members to community admins'
  );

  const adminUpdates = sandbox.defaultCommunityMembershipUpdates(
    'AdminMember',
    { authUid: 'uid-admin-member', isAdmin: true, joined: 4567 },
    9999
  );
  assertEqual(
    adminUpdates['communities/nyc/admins/uid-admin-member'],
    true,
    'defaultCommunityMembershipUpdates mirrors admin users into community admins'
  );
  assertEqual(
    adminUpdates['userCommunities/uid-admin-member/nyc'].role,
    'admin',
    'defaultCommunityMembershipUpdates preserves admin role in reverse index'
  );

  const usernameOnlyUpdates = sandbox.defaultCommunityMembershipUpdates('ImportedOnly', {}, 9999);
  assertEqual(
    usernameOnlyUpdates['communities/nyc/memberUsernames/ImportedOnly'],
    true,
    'defaultCommunityMembershipUpdates indexes username-only imported users'
  );
  assert(
    !Object.keys(usernameOnlyUpdates).some(key => key.startsWith('communities/nyc/members/')),
    'defaultCommunityMembershipUpdates does not create UID member path without authUid'
  );
  assert(
    !Object.keys(usernameOnlyUpdates).some(key => key.startsWith('userCommunities/')),
    'defaultCommunityMembershipUpdates does not create reverse index without authUid'
  );

  assertEqual(sandbox.recordCommunityId({}), 'nyc', 'recordCommunityId defaults missing communityId');
  assertEqual(sandbox.recordCommunityId({ communityId: '' }), 'nyc', 'recordCommunityId defaults blank communityId');
  assertEqual(sandbox.recordCommunityId({ communityId: 'NYC' }), 'nyc', 'recordCommunityId normalizes explicit communityId');

  assertEqual(sandbox.getCurrentCommunityId(), 'nyc', 'getCurrentCommunityId returns default community when feature flag is false');
  assertEqual(sandbox.isUserInCommunity('OutsideUser'), true, 'isUserInCommunity preserves global visibility when feature flag is false');

  const names = ['Alpha', 'OutsideUser'];
  assertEqual(
    sandbox.filterUsersBySelectedCommunity(names),
    names,
    'filterUsersBySelectedCommunity returns the original list when feature flag is false'
  );
  assertDeepEqual(
    Array.from(sandbox.getCommunityMemberUsernames()).sort(),
    ['AdminUser', 'Alpha', 'Beta', 'OwnerUser'],
    'getCommunityMemberUsernames falls back to all users when feature flag is false'
  );

  assertEqual(
    sandbox.canManageCommunity('any-uid', 'not-nyc'),
    true,
    'canManageCommunity preserves existing admin behavior when feature flag is false'
  );
  sandbox.allData.users.AdminUser.isAdmin = false;
  assertEqual(
    sandbox.canManageCommunity('any-uid', 'not-nyc'),
    false,
    'canManageCommunity still respects existing admin flag when feature flag is false'
  );

  assertEqual(sandbox.validateNonDefaultCommunityId('').ok, false, 'validateNonDefaultCommunityId rejects blank ids');
  assertEqual(sandbox.validateNonDefaultCommunityId('nyc').ok, false, 'validateNonDefaultCommunityId rejects nyc');
  assertEqual(sandbox.validateNonDefaultCommunityId('Chicago').ok, false, 'validateNonDefaultCommunityId rejects uppercase ids');
  ['bad.id', 'bad#id', 'bad$id', 'bad[id', 'bad]id', 'bad/id', 'bad_id'].forEach(value => {
    assertEqual(
      sandbox.validateNonDefaultCommunityId(value).ok,
      false,
      `validateNonDefaultCommunityId rejects invalid id ${value}`
    );
  });
  assertDeepEqual(
    sandbox.validateNonDefaultCommunityId('chicago-go-fest'),
    { ok: true, id: 'chicago-go-fest' },
    'validateNonDefaultCommunityId accepts lowercase path-safe ids'
  );

  sandbox.cur = 'OwnerUser';
  sandbox.currentAuthUid = 'uid-owner';
  sandbox.allData.userCommunities = {};
  const prep = sandbox.buildNonDefaultCommunityPreparation({
    communityId: 'chicago-go-fest',
    name: 'Chicago GO Fest',
    description: 'Private test community',
    visibility: 'inviteOnly'
  });
  assertEqual(prep.ok, true, 'buildNonDefaultCommunityPreparation accepts valid owner input');
  assertDeepEqual(
    Object.keys(prep.updates).sort(),
    ['communities/chicago-go-fest', 'userCommunities/uid-owner/chicago-go-fest'],
    'buildNonDefaultCommunityPreparation limits writes to community record and owner reverse index'
  );
  assertEqual(
    prep.updates['communities/chicago-go-fest'].memberUsernames.OwnerUser,
    true,
    'buildNonDefaultCommunityPreparation indexes owner username in the new community'
  );
  assertEqual(
    prep.updates['communities/chicago-go-fest'].members['uid-owner'],
    true,
    'buildNonDefaultCommunityPreparation indexes owner UID as a member'
  );
  assertEqual(
    prep.updates['communities/chicago-go-fest'].admins['uid-owner'],
    true,
    'buildNonDefaultCommunityPreparation indexes owner UID as an admin'
  );
  assertDeepEqual(
    prep.updates['userCommunities/uid-owner/chicago-go-fest'],
    { role: 'owner', username: 'OwnerUser', joinedAt: prep.updates['communities/chicago-go-fest'].createdAt },
    'buildNonDefaultCommunityPreparation writes owner reverse index payload'
  );
  assertEqual(
    prep.updates['communities/chicago-go-fest'].visibility,
    'inviteOnly',
    'buildNonDefaultCommunityPreparation preserves supported visibility'
  );
  assertEqual(
    sandbox.buildNonDefaultCommunityPreparation({ communityId: 'bad/id' }).ok,
    false,
    'buildNonDefaultCommunityPreparation rejects invalid ids before producing writes'
  );
}

runSourceWiringChecks();
runBehaviorChecks();

console.log('Community membership indexing checks passed.');
