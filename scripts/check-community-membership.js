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
  const preparedPreviewCommunities = extractFunctionSource('preparedPreviewCommunities');
  const ownerPreviewCommunityId = extractFunctionSource('ownerPreviewCommunityId');
  const setOwnerPreviewCommunityId = extractFunctionSource('setOwnerPreviewCommunityId');
  const ownerPreviewCommunityMemberUsernames = extractFunctionSource('ownerPreviewCommunityMemberUsernames');
  const ownerPreviewAllowsOffer = extractFunctionSource('ownerPreviewAllowsOffer');
  const schedulePreviewAllowsTrade = extractFunctionSource('schedulePreviewAllowsTrade');
  const renderCommunityMigrationPanel = extractFunctionSource('renderCommunityMigrationPanel');
  const memberCommunityOptions = extractFunctionSource('memberCommunityOptions');
  const currentCommunityIsSelectable = extractFunctionSource('currentCommunityIsSelectable');
  const getCurrentCommunityId = extractFunctionSource('getCurrentCommunityId');
  const setCurrentCommunityId = extractFunctionSource('setCurrentCommunityId');
  const filterUsersBySelectedCommunity = extractFunctionSource('filterUsersBySelectedCommunity');
  const renderMemberCommunitySwitcher = extractFunctionSource('renderMemberCommunitySwitcher');

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
  assert(
    /\bconst\s+OWNER_COMMUNITY_PREVIEW_SELECTED_KEY\s*=\s*'pogoOwnerCommunityPreviewCommunity_v1'\s*;/.test(html),
    'owner preview community selection must use a dedicated localStorage key'
  );
  assert(
    html.includes("const SELECTED_COMMUNITY_KEY='pogoSelectedCommunityId_v1';"),
    'public selected-community key must remain separate from owner preview selection key'
  );
  assertSourceIncludes(
    getCurrentCommunityId,
    'lsGet(SELECTED_COMMUNITY_KEY,DEFAULT_COMMUNITY_ID)',
    'future public selected-community helper must read the public selected-community localStorage key'
  );
  assertSourceIncludes(
    getCurrentCommunityId,
    'currentCommunityIsSelectable(stored)?stored:DEFAULT_COMMUNITY_ID',
    'future public selected-community helper must fall back to DEFAULT_COMMUNITY_ID when selected community is missing or not one of the member memberships'
  );
  assertSourceIncludes(
    memberCommunityOptions,
    'allData.userCommunities?.[uid]',
    'member-facing community options must use userCommunities when available'
  );
  assertSourceIncludes(
    memberCommunityOptions,
    'community.memberUsernames?.[username]',
    'member-facing community options must fall back to community memberUsernames'
  );
  assertSourceIncludes(
    currentCommunityIsSelectable,
    'memberCommunityOptions().some(c=>c.id===cid)',
    'future public selected community must be one of the signed-in user memberships'
  );
  assertSourceIncludes(
    setCurrentCommunityId,
    'lsSet(SELECTED_COMMUNITY_KEY,selected)',
    'member-facing switcher must store selection in the public selected-community localStorage key'
  );
  assert(
    !setCurrentCommunityId.includes('OWNER_COMMUNITY_PREVIEW_SELECTED_KEY'),
    'member-facing switcher must not write owner-preview localStorage state'
  );
  assert(
    !/[^\w]update\s*\(|[^\w]set\s*\(|ref\s*\(/.test(setCurrentCommunityId),
    'member-facing switcher selection must not write Firebase'
  );
  assertSourceIncludes(
    renderMemberCommunitySwitcher,
    'if(!MULTI_COMMUNITY_ENABLED||!cur)',
    'member-facing switcher UI must be gated by MULTI_COMMUNITY_ENABLED'
  );
  assertSourceIncludes(
    renderMemberCommunitySwitcher,
    'memberCommunityOptions()',
    'member-facing switcher UI must list only current member communities'
  );
  assertSourceIncludes(
    renderMemberCommunitySwitcher,
    'onchange="setCurrentCommunityId(this.value)"',
    'member-facing switcher UI must update through selected-community helper'
  );
  assertSourceIncludes(
    filterUsersBySelectedCommunity,
    'return usernames.filter(u=>members.has(u));',
    'future public selected-community filtering must filter username lists, not Pokémon records'
  );
  assertSourceIncludes(
    preparedPreviewCommunities,
    '.filter(([id,c])=>c&&c.preparedAt)',
    'owner preview selector must list prepared communities only'
  );
  assertSourceIncludes(
    ownerPreviewCommunityId,
    'lsGet(OWNER_COMMUNITY_PREVIEW_SELECTED_KEY,DEFAULT_COMMUNITY_ID)',
    'owner preview community id must read the dedicated localStorage key'
  );
  assertSourceIncludes(
    ownerPreviewCommunityId,
    "return community?.preparedAt?stored:DEFAULT_COMMUNITY_ID;",
    'owner preview community id must fall back to DEFAULT_COMMUNITY_ID when the selected community is not prepared'
  );
  assertSourceIncludes(
    setOwnerPreviewCommunityId,
    'ownerCanUseCommunityTools()',
    'owner preview community setter must be function-level owner guarded'
  );
  assertSourceIncludes(
    setOwnerPreviewCommunityId,
    'lsSet(OWNER_COMMUNITY_PREVIEW_SELECTED_KEY,cid)',
    'owner preview community setter must persist preview selection in localStorage only'
  );
  assert(
    !setOwnerPreviewCommunityId.includes('SELECTED_COMMUNITY_KEY') && !setOwnerPreviewCommunityId.includes('setCurrentCommunityId('),
    'owner preview community setter must not write public selected-community state'
  );
  assert(
    !/[^\w]update\s*\(|[^\w]set\s*\(|ref\s*\(/.test(setOwnerPreviewCommunityId),
    'owner preview community setter must not write Firebase'
  );
  assertSourceIncludes(
    ownerPreviewCommunityMemberUsernames,
    'ownerPreviewCommunityRecord()',
    'owner preview member filter must use the selected preview community record'
  );
  assertSourceIncludes(
    ownerPreviewCommunityMemberUsernames,
    'community.memberUsernames',
    'owner preview must filter by community memberUsernames'
  );
  assertSourceIncludes(
    ownerPreviewAllowsOffer,
    'communityId!==ownerPreviewCommunityId()',
    'owner preview offer filtering must respect the selected preview community'
  );
  assertSourceIncludes(
    schedulePreviewAllowsTrade,
    'recordCommunityId(t)!==ownerPreviewCommunityId()',
    'owner preview schedule filtering must respect the selected preview community'
  );
  assertSourceIncludes(
    renderCommunityMigrationPanel,
    'Pokémon lists and inventory stay user-global',
    'owner preview UI must state the user-global Pokémon data invariant'
  );
  assert(
    !/communities\/(?:\$\{[^}]+\}|[^`'"\s]+)\/(?:wishlist|dynamax|gmax|costumes|have)\b/.test(html),
    'community paths must not nest Pokémon list/inventory data under communities'
  );
  assert(
    !/`(?:wishlist|dynamax|gmax|costumes|have)\/\$\{[^}]*community/i.test(html),
    'selected community must not be used to write or read community-scoped Pokémon data paths'
  );
}

function runBehaviorChecks() {
  const localStore = {};
  const sandbox = {
    Date,
    OWNER: 'Doomsday126',
    DEFAULT_COMMUNITY_ID: 'nyc',
    COMMUNITY_VISIBILITIES: ['private', 'inviteOnly', 'public'],
    MULTI_COMMUNITY_ENABLED: false,
    MULTI_COMMUNITY_OWNER_PREVIEW_AVAILABLE: true,
    SELECTED_COMMUNITY_KEY: 'selectedCommunityId',
    OWNER_COMMUNITY_PREVIEW_KEY: 'ownerPreviewEnabled',
    OWNER_COMMUNITY_PREVIEW_SELECTED_KEY: 'ownerPreviewCommunity',
    currentAuthUid: 'auth-admin',
    cur: 'AdminUser',
    haveView: 'browse',
    localStore,
    lsWrites: [],
    toastMessages: [],
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
          name: 'NYC',
          preparedAt: 111,
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
    lsGet(key, fallback) {
      return Object.prototype.hasOwnProperty.call(localStore, key) ? localStore[key] : fallback;
    },
    lsSet(key, value) {
      localStore[key] = value;
      sandbox.lsWrites.push([key, value]);
    },
    toast(message) {
      sandbox.toastMessages.push(message);
    },
    ensureProtectedSubscriptions() {},
    renderCommunityMigrationPanel() {},
    renderMemberCommunitySwitcher() {},
    renderActiveTab() {},
    refreshBadgesAndLightChrome() {},
    renderBrowse() {},
    renderStrings() {},
    renderSchedule() {},
    renderHaveBrowse() {},
    activeUsers() {
      return null;
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
      extractFunctionSource('ownerCanUseCommunityTools'),
      extractFunctionSource('ownerCommunityPreviewOn'),
      extractFunctionSource('preparedPreviewCommunities'),
      extractFunctionSource('ownerPreviewCommunityId'),
      extractFunctionSource('ownerPreviewCommunityRecord'),
      extractFunctionSource('ownerPreviewCommunityName'),
      extractFunctionSource('setOwnerPreviewCommunityId'),
      extractFunctionSource('ownerPreviewCommunityMemberUsernames'),
      extractFunctionSource('ownerPreviewAllowsUser'),
      extractFunctionSource('ownerPreviewAllowsOffer'),
      extractFunctionSource('scheduledTradeOtherUsers'),
      extractFunctionSource('schedulePreviewAllowsTrade'),
      extractFunctionSource('memberCommunityOptions'),
      extractFunctionSource('currentCommunityIsSelectable'),
      extractFunctionSource('getCurrentCommunityId'),
      extractFunctionSource('setCurrentCommunityId'),
      extractFunctionSource('getCommunityMemberUsernames'),
      extractFunctionSource('isUserInCommunity'),
      extractFunctionSource('filterUsersBySelectedCommunity'),
      extractFunctionSource('canManageCommunity'),
      extractFunctionSource('recordCommunityId'),
      extractFunctionSource('recordBelongsToSelectedCommunity')
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
  sandbox.lsWrites = [];
  assertEqual(
    sandbox.setCurrentCommunityId('new-jersey'),
    'new-jersey',
    'setCurrentCommunityId preserves existing setter behavior while feature flag is false'
  );
  assertDeepEqual(
    sandbox.lsWrites,
    [[sandbox.SELECTED_COMMUNITY_KEY, 'new-jersey']],
    'setCurrentCommunityId writes only the public selected-community key while feature flag is false'
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

  assertDeepEqual(
    sandbox.preparedPreviewCommunities().map(([id]) => id),
    ['nyc', 'new-jersey'],
    'preparedPreviewCommunities lists prepared communities with nyc first'
  );
  localStore[sandbox.OWNER_COMMUNITY_PREVIEW_KEY] = true;
  localStore[sandbox.OWNER_COMMUNITY_PREVIEW_SELECTED_KEY] = 'new-jersey';
  assertEqual(sandbox.ownerCommunityPreviewOn(), true, 'ownerCommunityPreviewOn enables owner-only preview from localStorage');
  assertEqual(sandbox.ownerPreviewCommunityId(), 'new-jersey', 'ownerPreviewCommunityId reads the local-only preview community key');
  assertEqual(sandbox.ownerPreviewCommunityName(), 'New Jersey', 'ownerPreviewCommunityName resolves selected prepared community name');
  assertDeepEqual(
    Array.from(sandbox.ownerPreviewCommunityMemberUsernames()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'ownerPreviewCommunityMemberUsernames filters by selected community memberUsernames'
  );
  assertEqual(sandbox.ownerPreviewAllowsUser('UsernameOnly'), true, 'owner preview allows selected community members');
  assertEqual(sandbox.ownerPreviewAllowsUser('Alpha'), false, 'owner preview hides users outside the selected community');
  assertEqual(
    sandbox.ownerPreviewAllowsOffer({ from: 'OwnerUser', communityId: 'new-jersey' }, 'UsernameOnly'),
    true,
    'ownerPreviewAllowsOffer allows selected-community offers between selected-community members'
  );
  assertEqual(
    sandbox.ownerPreviewAllowsOffer({ from: 'OwnerUser' }, 'UsernameOnly'),
    false,
    'ownerPreviewAllowsOffer treats missing communityId as nyc and hides it in non-nyc preview'
  );
  assertEqual(
    sandbox.schedulePreviewAllowsTrade({
      organizer: 'OwnerUser',
      participants: { OwnerUser: true, UsernameOnly: true },
      communityId: 'new-jersey'
    }),
    true,
    'schedulePreviewAllowsTrade allows selected-community schedule rows whose partners are selected-community members'
  );
  assertEqual(
    sandbox.schedulePreviewAllowsTrade({
      organizer: 'OwnerUser',
      participants: { OwnerUser: true, UsernameOnly: true }
    }),
    false,
    'schedulePreviewAllowsTrade treats missing communityId as nyc and hides it in non-nyc preview'
  );
  sandbox.lsWrites = [];
  sandbox.setOwnerPreviewCommunityId('new-jersey');
  assertDeepEqual(
    sandbox.lsWrites,
    [[sandbox.OWNER_COMMUNITY_PREVIEW_SELECTED_KEY, 'new-jersey']],
    'setOwnerPreviewCommunityId writes only the owner-preview localStorage key'
  );
  assert(
    !sandbox.lsWrites.some(([key]) => key === sandbox.SELECTED_COMMUNITY_KEY),
    'setOwnerPreviewCommunityId must not write public selected-community localStorage'
  );
  sandbox.lsWrites = [];
  sandbox.setOwnerPreviewCommunityId('draft-only');
  assertDeepEqual(
    sandbox.lsWrites,
    [],
    'setOwnerPreviewCommunityId rejects unprepared communities without mutating localStorage'
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

  sandbox.MULTI_COMMUNITY_ENABLED = true;
  sandbox.cur = 'OwnerUser';
  sandbox.currentAuthUid = 'uid-owner';
  sandbox.allData.userCommunities = {
    'uid-owner': {
      'new-jersey': { role: 'owner', username: 'OwnerUser', joinedAt: 777 }
    },
    'uid-community-admin': {
      'new-jersey': { role: 'admin', username: 'AdminInCommunity', joinedAt: 333 }
    },
    'uid-false-admin': {
      'new-jersey': { role: 'member', username: 'FalseAdminEntry', joinedAt: 444 }
    }
  };
  sandbox.allData.wishlist = { Alpha: { Pikachu: 'H' }, OwnerUser: { Eevee: 'M' } };
  sandbox.allData.dynamax = { UsernameOnly: { Bulbasaur: 'L' } };
  sandbox.allData.gmax = { AdminInCommunity: { Charizard: 'H' } };
  sandbox.allData.costumes = { FalseAdminEntry: { 'Pikachu (Holiday)': 'M' } };
  sandbox.allData.have = { OwnerUser: { Heracross: 2 }, Alpha: { Pidgey: 5 } };
  const pokemonDataBefore = JSON.stringify({
    wishlist: sandbox.allData.wishlist,
    dynamax: sandbox.allData.dynamax,
    gmax: sandbox.allData.gmax,
    costumes: sandbox.allData.costumes,
    have: sandbox.allData.have
  });
  assertDeepEqual(
    sandbox.memberCommunityOptions().map(c => c.id),
    ['new-jersey'],
    'future public switcher: memberCommunityOptions lists only communities for the signed-in user'
  );
  sandbox.cur = 'UsernameOnly';
  sandbox.currentAuthUid = '';
  assertDeepEqual(
    sandbox.memberCommunityOptions().map(c => c.id),
    ['new-jersey'],
    'future public switcher: memberCommunityOptions falls back to memberUsernames when userCommunities is unavailable'
  );
  sandbox.cur = 'OwnerUser';
  sandbox.currentAuthUid = 'uid-owner';
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'new-jersey';
  assertEqual(
    sandbox.getCurrentCommunityId(),
    'new-jersey',
    'future public switcher: getCurrentCommunityId reads selected community from public localStorage key'
  );
  assertDeepEqual(
    Array.from(sandbox.getCommunityMemberUsernames()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public switcher: getCommunityMemberUsernames returns selected community memberUsernames'
  );
  assertDeepEqual(
    sandbox.filterUsersBySelectedCommunity(['Alpha', 'OwnerUser', 'UsernameOnly', 'Missing']),
    ['OwnerUser', 'UsernameOnly'],
    'future public switcher: filterUsersBySelectedCommunity filters usernames only'
  );
  assertEqual(
    sandbox.isUserInCommunity('OwnerUser'),
    true,
    'future public switcher: isUserInCommunity returns true for selected community members'
  );
  assertEqual(
    sandbox.isUserInCommunity('Alpha'),
    false,
    'future public switcher: isUserInCommunity returns false for users outside the selected community'
  );
  assertEqual(
    sandbox.recordCommunityId({}),
    'nyc',
    'future public switcher: recordCommunityId defaults missing communityId to nyc'
  );
  assertEqual(
    sandbox.recordBelongsToSelectedCommunity({}),
    false,
    'future public switcher: missing communityId records are treated as nyc and hidden when another community is selected'
  );
  assertEqual(
    sandbox.recordBelongsToSelectedCommunity({ communityId: 'new-jersey' }),
    true,
    'future public switcher: selected community records remain visible'
  );
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'draft-only';
  assertEqual(
    sandbox.getCurrentCommunityId(),
    'nyc',
    'future public switcher: existing but unjoined selected community falls back to nyc'
  );
  sandbox.lsWrites = [];
  sandbox.setCurrentCommunityId('new-jersey');
  assertDeepEqual(
    sandbox.lsWrites,
    [[sandbox.SELECTED_COMMUNITY_KEY, 'new-jersey']],
    'future public switcher: setCurrentCommunityId writes only the public selected-community key for joined communities'
  );
  sandbox.lsWrites = [];
  sandbox.setCurrentCommunityId('draft-only');
  assertDeepEqual(
    sandbox.lsWrites,
    [[sandbox.SELECTED_COMMUNITY_KEY, 'nyc']],
    'future public switcher: setCurrentCommunityId stores nyc fallback for unjoined communities'
  );
  assert(
    !sandbox.lsWrites.some(([key]) => key === sandbox.OWNER_COMMUNITY_PREVIEW_SELECTED_KEY),
    'future public switcher: setCurrentCommunityId must not write owner-preview localStorage'
  );
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'missing-community';
  assertEqual(
    sandbox.getCurrentCommunityId(),
    'nyc',
    'future public switcher: missing selected community falls back to nyc'
  );
  assertEqual(
    sandbox.recordBelongsToSelectedCommunity({}),
    true,
    'future public switcher: missing communityId records are visible after fallback to nyc'
  );
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = '';
  assertEqual(
    sandbox.getCurrentCommunityId(),
    'nyc',
    'future public switcher: blank selected community falls back to nyc'
  );
  assertEqual(
    JSON.stringify({
      wishlist: sandbox.allData.wishlist,
      dynamax: sandbox.allData.dynamax,
      gmax: sandbox.allData.gmax,
      costumes: sandbox.allData.costumes,
      have: sandbox.allData.have
    }),
    pokemonDataBefore,
    'future public switcher: selected-community helpers do not mutate user-global Pokémon records'
  );
}

runSourceWiringChecks();
runBehaviorChecks();

console.log('Community membership indexing checks passed.');
