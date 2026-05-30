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
  const validatePreparedNonDefaultCommunityId = extractFunctionSource('validatePreparedNonDefaultCommunityId');
  const buildNonDefaultCommunityMemberAssignment = extractFunctionSource('buildNonDefaultCommunityMemberAssignment');
  const buildNonDefaultCommunityMemberRemoval = extractFunctionSource('buildNonDefaultCommunityMemberRemoval');
  const assignNonDefaultCommunityMember = extractFunctionSource('assignNonDefaultCommunityMember');
  const removeNonDefaultCommunityMember = extractFunctionSource('removeNonDefaultCommunityMember');
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
  assertSourceIncludes(
    validatePreparedNonDefaultCommunityId,
    'validateNonDefaultCommunityId(rawId)',
    'prepared non-default community validation must reuse non-default id validation'
  );
  assertSourceIncludes(
    validatePreparedNonDefaultCommunityId,
    '!community||!community.preparedAt',
    'prepared non-default community validation must reject unprepared communities'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberAssignment,
    'allData.users?.[username]',
    'non-default member assignment must only allow existing users'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberAssignment,
    'communities/${id}/memberUsernames/${username}',
    'non-default member assignment must write community memberUsernames path'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberAssignment,
    'communities/${id}/members/${uid}',
    'non-default member assignment must write UID member path when authUid exists'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberAssignment,
    'userCommunities/${uid}/${id}',
    'non-default member assignment must write reverse index when authUid exists'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberAssignment,
    'communities/${id}/updatedAt',
    'non-default member assignment must update community updatedAt'
  );
  assert(
    !buildNonDefaultCommunityMemberAssignment.includes('admins/${uid}'),
    'non-default member assignment must not grant community admin role'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberRemoval,
    'if(community.ownerUsername===username||(uid&&community.ownerId===uid))',
    'non-default member removal must reject removing the community owner'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberRemoval,
    'communities/${id}/memberUsernames/${username}`]:null',
    'non-default member removal must delete community memberUsernames path'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberRemoval,
    'communities/${id}/members/${uid}`]=null',
    'non-default member removal must delete UID member path when authUid exists'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberRemoval,
    'userCommunities/${uid}/${id}`]=null',
    'non-default member removal must delete reverse index when authUid exists'
  );
  assertSourceIncludes(
    buildNonDefaultCommunityMemberRemoval,
    'Object.prototype.hasOwnProperty.call(community.admins||{},uid)',
    'non-default member removal must delete stale community admin entry when present'
  );
  assertSourceIncludes(
    assignNonDefaultCommunityMember,
    'ownerCanUseCommunityTools()',
    'non-default member assignment action must be function-level owner guarded'
  );
  assertSourceIncludes(
    removeNonDefaultCommunityMember,
    'ownerCanUseCommunityTools()',
    'non-default member removal action must be function-level owner guarded'
  );
  assert(
    !assignNonDefaultCommunityMember.includes('setCurrentCommunityId(') && !removeNonDefaultCommunityMember.includes('setCurrentCommunityId('),
    'non-default member assignment/removal must not switch the selected community'
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
        MemberUser: { authUid: 'uid-member', joined: 222 },
        AdminInCommunity: { authUid: 'uid-community-admin', joined: 333 },
        FalseAdminEntry: { authUid: 'uid-false-admin', joined: 444 },
        UsernameOnly: {},
        Alpha: {},
        Beta: {}
      },
      communities: {
        nyc: {
          memberUsernames: { Alpha: true },
          members: { 'uid-alpha': true },
          admins: {}
        },
        'new-jersey': {
          name: 'New Jersey',
          slug: 'new-jersey',
          preparedAt: 123,
          ownerId: 'uid-owner',
          ownerUsername: 'OwnerUser',
          memberUsernames: { OwnerUser: true, AdminInCommunity: true, FalseAdminEntry: true, UsernameOnly: true },
          members: { 'uid-owner': true, 'uid-community-admin': true, 'uid-false-admin': true },
          admins: { 'uid-owner': true, 'uid-community-admin': true, 'uid-false-admin': false }
        },
        'draft-only': {
          name: 'Draft Only',
          slug: 'draft-only',
          memberUsernames: {}
        }
      },
      userCommunities: {
        'uid-owner': {
          'new-jersey': { role: 'owner', username: 'OwnerUser', joinedAt: 777 }
        },
        'uid-community-admin': {
          'new-jersey': { role: 'admin', username: 'AdminInCommunity', joinedAt: 333 }
        },
        'uid-false-admin': {
          'new-jersey': { role: 'member', username: 'FalseAdminEntry', joinedAt: 444 }
        }
      }
    },
    lsGet(_key, fallback) {
      return fallback;
    },
    alphaCompare(a, b) {
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
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
      extractFunctionSource('preparedNonDefaultCommunities'),
      extractFunctionSource('validatePreparedNonDefaultCommunityId'),
      extractFunctionSource('normalizeCommunityRecord'),
      extractFunctionSource('buildNonDefaultCommunityPreparation'),
      extractFunctionSource('buildNonDefaultCommunityMemberAssignment'),
      extractFunctionSource('buildNonDefaultCommunityMemberRemoval'),
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
    ['AdminInCommunity', 'AdminUser', 'Alpha', 'Beta', 'FalseAdminEntry', 'MemberUser', 'OwnerUser', 'UsernameOnly'],
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

  assertDeepEqual(
    sandbox.preparedNonDefaultCommunities().map(([id]) => id),
    ['new-jersey'],
    'preparedNonDefaultCommunities lists prepared non-default communities only'
  );
  assertEqual(
    sandbox.validatePreparedNonDefaultCommunityId('nyc').ok,
    false,
    'validatePreparedNonDefaultCommunityId rejects nyc'
  );
  assertEqual(
    sandbox.validatePreparedNonDefaultCommunityId('draft-only').ok,
    false,
    'validatePreparedNonDefaultCommunityId rejects unprepared communities'
  );
  assertEqual(
    sandbox.validatePreparedNonDefaultCommunityId('missing-community').ok,
    false,
    'validatePreparedNonDefaultCommunityId rejects missing communities'
  );

  const assignment = sandbox.buildNonDefaultCommunityMemberAssignment({
    communityId: 'new-jersey',
    username: 'MemberUser'
  });
  assertEqual(assignment.ok, true, 'buildNonDefaultCommunityMemberAssignment accepts existing auth-linked users');
  assertDeepEqual(
    Object.keys(assignment.updates).sort(),
    [
      'communities/new-jersey/memberUsernames/MemberUser',
      'communities/new-jersey/members/uid-member',
      'communities/new-jersey/updatedAt',
      'userCommunities/uid-member/new-jersey'
    ],
    'buildNonDefaultCommunityMemberAssignment writes only membership indexes and updatedAt for auth-linked users'
  );
  assertDeepEqual(
    assignment.updates['userCommunities/uid-member/new-jersey'],
    { role: 'member', username: 'MemberUser', joinedAt: 222 },
    'buildNonDefaultCommunityMemberAssignment writes member-only reverse index payload'
  );
  assert(
    !Object.keys(assignment.updates).some(key => key.includes('/admins/')),
    'buildNonDefaultCommunityMemberAssignment does not write admin paths'
  );

  const usernameOnlyAssignment = sandbox.buildNonDefaultCommunityMemberAssignment({
    communityId: 'new-jersey',
    username: 'UsernameOnly'
  });
  assertEqual(usernameOnlyAssignment.ok, true, 'buildNonDefaultCommunityMemberAssignment accepts username-only users');
  assertDeepEqual(
    Object.keys(usernameOnlyAssignment.updates).sort(),
    [
      'communities/new-jersey/memberUsernames/UsernameOnly',
      'communities/new-jersey/updatedAt'
    ],
    'buildNonDefaultCommunityMemberAssignment writes no fake UID paths for username-only users'
  );
  assertEqual(
    sandbox.buildNonDefaultCommunityMemberAssignment({ communityId: 'new-jersey', username: 'MissingUser' }).ok,
    false,
    'buildNonDefaultCommunityMemberAssignment rejects unknown users'
  );
  assertEqual(
    sandbox.buildNonDefaultCommunityMemberAssignment({ communityId: 'nyc', username: 'MemberUser' }).ok,
    false,
    'buildNonDefaultCommunityMemberAssignment rejects nyc'
  );

  const removal = sandbox.buildNonDefaultCommunityMemberRemoval({
    communityId: 'new-jersey',
    username: 'AdminInCommunity'
  });
  assertEqual(removal.ok, true, 'buildNonDefaultCommunityMemberRemoval accepts removable auth-linked users');
  assertDeepEqual(
    removal.updates,
    {
      'communities/new-jersey/memberUsernames/AdminInCommunity': null,
      'communities/new-jersey/updatedAt': removal.updates['communities/new-jersey/updatedAt'],
      'communities/new-jersey/members/uid-community-admin': null,
      'userCommunities/uid-community-admin/new-jersey': null,
      'communities/new-jersey/admins/uid-community-admin': null
    },
    'buildNonDefaultCommunityMemberRemoval deletes member, reverse, stale-admin indexes and updates updatedAt'
  );

  const falseAdminRemoval = sandbox.buildNonDefaultCommunityMemberRemoval({
    communityId: 'new-jersey',
    username: 'FalseAdminEntry'
  });
  assertEqual(falseAdminRemoval.ok, true, 'buildNonDefaultCommunityMemberRemoval accepts users with falsey stale admin entries');
  assertEqual(
    falseAdminRemoval.updates['communities/new-jersey/admins/uid-false-admin'],
    null,
    'buildNonDefaultCommunityMemberRemoval deletes stale admin key even when the value is falsey'
  );

  const usernameOnlyRemoval = sandbox.buildNonDefaultCommunityMemberRemoval({
    communityId: 'new-jersey',
    username: 'UsernameOnly'
  });
  assertEqual(usernameOnlyRemoval.ok, true, 'buildNonDefaultCommunityMemberRemoval accepts username-only users');
  assertDeepEqual(
    Object.keys(usernameOnlyRemoval.updates).sort(),
    [
      'communities/new-jersey/memberUsernames/UsernameOnly',
      'communities/new-jersey/updatedAt'
    ],
    'buildNonDefaultCommunityMemberRemoval writes no fake UID delete paths for username-only users'
  );
  assertEqual(
    sandbox.buildNonDefaultCommunityMemberRemoval({ communityId: 'new-jersey', username: 'OwnerUser' }).ok,
    false,
    'buildNonDefaultCommunityMemberRemoval rejects removing the community owner'
  );
  assertEqual(
    sandbox.buildNonDefaultCommunityMemberRemoval({ communityId: 'nyc', username: 'MemberUser' }).ok,
    false,
    'buildNonDefaultCommunityMemberRemoval rejects nyc removal'
  );
}

runSourceWiringChecks();
runBehaviorChecks();

console.log('Community membership indexing checks passed.');
