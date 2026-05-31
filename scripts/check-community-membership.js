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
  const offerInReadScope = extractFunctionSource('offerInReadScope');
  const schedulePreviewAllowsTrade = extractFunctionSource('schedulePreviewAllowsTrade');
  const selectedCommunityMemberUsernames = extractFunctionSource('selectedCommunityMemberUsernames');
  const readScopeMemberUsernames = extractFunctionSource('readScopeMemberUsernames');
  const readScopeAllowsUser = extractFunctionSource('readScopeAllowsUser');
  const browseAllowedUsers = extractFunctionSource('browseAllowedUsers');
  const stringsAllowedUsers = extractFunctionSource('stringsAllowedUsers');
  const inventoryBrowseAllowedUsers = extractFunctionSource('inventoryBrowseAllowedUsers');
  const scheduleAllowedUsers = extractFunctionSource('scheduleAllowedUsers');
  const guardReadScopeTrainer = extractFunctionSource('guardReadScopeTrainer');
  const openDiffModal = extractFunctionSource('openDiffModal');
  const openTradeMatchModal = extractFunctionSource('openTradeMatchModal');
  const submitOffer = extractFunctionSource('submitOffer');
  const submitScheduledTrade = extractFunctionSource('submitScheduledTrade');
  const _logAcceptedTrade = extractFunctionSource('_logAcceptedTrade');
  const writeTrade = extractFunctionSource('writeTrade');
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
    selectedCommunityMemberUsernames,
    'if(!MULTI_COMMUNITY_ENABLED)return null;',
    'selected-community read scope must remain disabled while MULTI_COMMUNITY_ENABLED is false'
  );
  assertSourceIncludes(
    selectedCommunityMemberUsernames,
    'getCommunityMemberUsernames()',
    'selected-community read scope must use the public selected-community membership helper'
  );
  assertSourceIncludes(
    readScopeMemberUsernames,
    'ownerPreviewCommunityMemberUsernames()||selectedCommunityMemberUsernames()',
    'shared read scope must prefer owner preview before public selected-community membership'
  );
  assertSourceIncludes(
    readScopeAllowsUser,
    'return !members||members.has(username);',
    'shared read-scope user guard must only filter usernames/member sets'
  );
  [
    ['browseAllowedUsers', browseAllowedUsers],
    ['stringsAllowedUsers', stringsAllowedUsers],
    ['inventoryBrowseAllowedUsers', inventoryBrowseAllowedUsers],
    ['scheduleAllowedUsers', scheduleAllowedUsers]
  ].forEach(([name, source]) => {
    assertSourceIncludes(
      source,
      'readScopeMemberUsernames()',
      `${name} must use the shared read-scope helper`
    );
    assert(
      !source.includes('ownerPreviewCommunityMemberUsernames()'),
      `${name} must not bypass shared read scope with owner-preview-only membership`
    );
  });
  assertSourceIncludes(
    schedulePreviewAllowsTrade,
    'readScopeMemberUsernames()',
    'schedule visible-row filtering must use shared read scope'
  );
  assertSourceIncludes(
    schedulePreviewAllowsTrade,
    'ownerCommunityPreviewOn()?ownerPreviewCommunityId():getCurrentCommunityId()',
    'schedule visible-row filtering must use owner preview community first, then public selected community'
  );
  assertSourceIncludes(
    guardReadScopeTrainer,
    'readScopeAllowsUser(username)',
    'Compare/Trade Match guard must use shared read-scope membership'
  );
  assertSourceIncludes(
    openDiffModal,
    "guardReadScopeTrainer(otherUsername,'compare')",
    'Compare modal must use read-scope-aware trainer guard'
  );
  assertSourceIncludes(
    openTradeMatchModal,
    "guardReadScopeTrainer(otherUsername,'trade match')",
    'Trade Match modal must use read-scope-aware trainer guard'
  );
  assertSourceIncludes(
    offerInReadScope,
    'readScopeMemberUsernames()',
    'offer read filtering must use shared read scope (owner preview + public selected community)'
  );
  assertSourceIncludes(
    offerInReadScope,
    'ownerCommunityPreviewOn()?ownerPreviewCommunityId():getCurrentCommunityId()',
    'offer read filtering must scope by owner preview first, then public selected community'
  );
  assertSourceIncludes(
    offerInReadScope,
    'recordCommunityId(offer)',
    'offer read filtering must default missing offer.communityId to DEFAULT_COMMUNITY_ID via recordCommunityId'
  );
  assert(
    !/\bownerPreviewAllowsOffer\b/.test(html),
    'ownerPreviewAllowsOffer must be fully removed once read scope is unified'
  );
  assertSourceIncludes(
    submitOffer,
    'communityId:getCurrentCommunityId()',
    'offer submission payload must remain unchanged'
  );
  assertSourceIncludes(
    submitScheduledTrade,
    'communityId:existing?.communityId||getCurrentCommunityId()',
    'submitScheduledTrade must stamp current community on new trades and preserve existing communityId on edits'
  );
  assertSourceIncludes(
    _logAcceptedTrade,
    'communityId:getCurrentCommunityId()',
    'auto-logged trades from offer-accept must stamp the organizer current community'
  );
  assert(
    !/getCurrentCommunityId\s*\(/.test(writeTrade),
    'writeTrade itself must not be modified to call getCurrentCommunityId'
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
    offerInReadScope,
    'recordCommunityId(offer)!==scopedCommunityId',
    'offer read filtering must reject offers whose communityId does not match the active read-scope community'
  );
  assertSourceIncludes(
    schedulePreviewAllowsTrade,
    'recordCommunityId(t)!==scopedCommunityId',
    'schedule preview/read filtering must respect the active read-scope community'
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
  function makeFakeElement() {
    return {
      innerHTML: '',
      style: {},
      classes: new Set(),
      classList: {
        add(name) {
          this._owner.classes.add(name);
        },
        remove(name) {
          this._owner.classes.delete(name);
        },
        contains(name) {
          return this._owner.classes.has(name);
        },
        _owner: null
      }
    };
  }
  const switcherEl = makeFakeElement();
  switcherEl.classList._owner = switcherEl;
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
    document: {
      getElementById(id) {
        return id === 'member-community-switcher' ? switcherEl : null;
      }
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
    escHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    },
    escAttr(value) {
      return sandbox.escHtml(value);
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
      extractFunctionSource('offerInReadScope'),
      extractFunctionSource('scheduledTradeOtherUsers'),
      extractFunctionSource('schedulePreviewAllowsTrade'),
      extractFunctionSource('selectedCommunityMemberUsernames'),
      extractFunctionSource('readScopeMemberUsernames'),
      extractFunctionSource('readScopeAllowsUser'),
      extractFunctionSource('browseAllowedUsers'),
      extractFunctionSource('stringsAllowedUsers'),
      extractFunctionSource('inventoryBrowseAllowedUsers'),
      extractFunctionSource('scheduleAllowedUsers'),
      extractFunctionSource('guardReadScopeTrainer'),
      extractFunctionSource('memberCommunityOptions'),
      extractFunctionSource('currentCommunityIsSelectable'),
      extractFunctionSource('getCurrentCommunityId'),
      extractFunctionSource('setCurrentCommunityId'),
      extractFunctionSource('getCommunityMemberUsernames'),
      extractFunctionSource('isUserInCommunity'),
      extractFunctionSource('filterUsersBySelectedCommunity'),
      extractFunctionSource('canManageCommunity'),
      extractFunctionSource('recordCommunityId'),
      extractFunctionSource('recordBelongsToSelectedCommunity'),
      extractFunctionSource('renderMemberCommunitySwitcher')
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
  sandbox.renderMemberCommunitySwitcher();
  assertEqual(
    switcherEl.style.display,
    'none',
    'flag-gated switcher behavior: renderMemberCommunitySwitcher hides while MULTI_COMMUNITY_ENABLED is false'
  );
  assertEqual(
    switcherEl.innerHTML,
    '',
    'flag-gated switcher behavior: hidden switcher does not render stale content while flag is false'
  );
  assertEqual(
    sandbox.selectedCommunityMemberUsernames(),
    null,
    'read-scope behavior: selected-community membership is disabled while MULTI_COMMUNITY_ENABLED is false'
  );
  assertEqual(
    sandbox.readScopeMemberUsernames(),
    null,
    'read-scope behavior: shared read scope returns no filter while flag is false and owner preview is off'
  );
  assertEqual(
    sandbox.readScopeAllowsUser('OutsideUser'),
    true,
    'read-scope behavior: shared guard preserves global visibility while flag is false'
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
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'nyc';
  assertDeepEqual(
    Array.from(sandbox.readScopeMemberUsernames()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'read-scope behavior: owner preview takes precedence over public selected-community membership'
  );
  assertEqual(
    sandbox.readScopeAllowsUser('UsernameOnly'),
    true,
    'read-scope behavior: owner preview allows selected preview-community members'
  );
  assertEqual(
    sandbox.readScopeAllowsUser('Alpha'),
    false,
    'read-scope behavior: owner preview hides users outside the preview community even when public selection differs'
  );
  assertEqual(
    sandbox.offerInReadScope({ from: 'OwnerUser', communityId: 'new-jersey' }, 'UsernameOnly'),
    true,
    'offerInReadScope allows selected-community offers between owner-preview-community members'
  );
  assertEqual(
    sandbox.offerInReadScope({ from: 'OwnerUser' }, 'UsernameOnly'),
    false,
    'offerInReadScope treats missing communityId as nyc and hides it in non-nyc preview'
  );
  // Owner preview must take precedence over public selected-community state.
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'new-jersey';
  sandbox.MULTI_COMMUNITY_ENABLED = true;
  assertEqual(
    sandbox.offerInReadScope({ from: 'OwnerUser', communityId: 'new-jersey' }, 'UsernameOnly'),
    true,
    'offerInReadScope: owner preview takes precedence over public selected-community when both target new-jersey'
  );
  assertEqual(
    sandbox.offerInReadScope({ from: 'Alpha', communityId: 'nyc' }, 'Alpha'),
    false,
    'offerInReadScope: owner preview hides nyc offers even when public selection is also non-nyc'
  );
  sandbox.MULTI_COMMUNITY_ENABLED = false;
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'nyc';
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
  localStore[sandbox.OWNER_COMMUNITY_PREVIEW_KEY] = false;
  sandbox.cur = 'OwnerUser';
  sandbox.currentAuthUid = 'uid-owner';
  sandbox.allData.communities.nyc.memberUsernames.OwnerUser = true;
  sandbox.allData.communities.nyc.members['uid-owner'] = true;
  sandbox.allData.userCommunities = {
    'uid-owner': {
      nyc: { role: 'member', username: 'OwnerUser', joinedAt: 777 },
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
    ['nyc', 'new-jersey'],
    'future public switcher: memberCommunityOptions lists only communities for the signed-in user, with nyc first'
  );
  switcherEl.innerHTML = '';
  switcherEl.style.display = 'none';
  switcherEl.classes.clear();
  sandbox.renderMemberCommunitySwitcher();
  assert(
    switcherEl.classList.contains('show'),
    'flag-gated switcher behavior: renderMemberCommunitySwitcher shows when flag is true and user has memberships'
  );
  assert(
    /<select[^>]+aria-label="Choose community view"/.test(switcherEl.innerHTML),
    'flag-gated switcher behavior: multiple memberships render a selector'
  );
  assert(
    switcherEl.innerHTML.includes('value="nyc"') && switcherEl.innerHTML.includes('value="new-jersey"'),
    'flag-gated switcher behavior: selector includes only joined communities'
  );
  assert(
    !switcherEl.innerHTML.includes('draft-only'),
    'flag-gated switcher behavior: selector excludes unjoined prepared communities'
  );
  sandbox.cur = 'UsernameOnly';
  sandbox.currentAuthUid = '';
  localStore[sandbox.SELECTED_COMMUNITY_KEY] = 'new-jersey';
  assertDeepEqual(
    sandbox.memberCommunityOptions().map(c => c.id),
    ['new-jersey'],
    'future public switcher: memberCommunityOptions falls back to memberUsernames when userCommunities is unavailable'
  );
  switcherEl.innerHTML = '';
  switcherEl.style.display = 'none';
  switcherEl.classes.clear();
  sandbox.renderMemberCommunitySwitcher();
  assert(
    !switcherEl.innerHTML.includes('<select'),
    'flag-gated switcher behavior: one-community membership follows current passive-label behavior instead of rendering a selector'
  );
  assert(
    switcherEl.innerHTML.includes('New Jersey'),
    'flag-gated switcher behavior: one-community membership labels the current community'
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
    Array.from(sandbox.selectedCommunityMemberUsernames()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: selectedCommunityMemberUsernames returns selected public community members'
  );
  assertDeepEqual(
    Array.from(sandbox.readScopeMemberUsernames()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: shared read scope uses selected public community when owner preview is off'
  );
  assertDeepEqual(
    Array.from(sandbox.browseAllowedUsers()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: Browse filters to selected community members'
  );
  assertDeepEqual(
    Array.from(sandbox.stringsAllowedUsers()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: Strings filters to selected community members'
  );
  assertDeepEqual(
    Array.from(sandbox.inventoryBrowseAllowedUsers()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: Inventory Community Browse filters to selected community members'
  );
  assertDeepEqual(
    Array.from(sandbox.scheduleAllowedUsers()).sort(),
    ['AdminInCommunity', 'FalseAdminEntry', 'OwnerUser', 'UsernameOnly'],
    'future public read scope: Schedule filters to selected community members'
  );
  assertEqual(
    sandbox.guardReadScopeTrainer('OwnerUser', 'compare'),
    true,
    'future public read scope: Compare/Trade Match guard allows selected community members'
  );
  sandbox.toastMessages = [];
  assertEqual(
    sandbox.guardReadScopeTrainer('Alpha', 'compare'),
    false,
    'future public read scope: Compare/Trade Match guard blocks users outside selected community'
  );
  assert(
    sandbox.toastMessages[0]?.includes('outside New Jersey'),
    'future public read scope: Compare/Trade Match guard names the selected community in its toast'
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
  assertEqual(
    sandbox.schedulePreviewAllowsTrade({
      organizer: 'OwnerUser',
      participants: { OwnerUser: true, UsernameOnly: true },
      communityId: 'new-jersey'
    }),
    true,
    'future public read scope: Schedule allows selected-community rows whose partners are selected-community members'
  );
  assertEqual(
    sandbox.schedulePreviewAllowsTrade({
      organizer: 'OwnerUser',
      participants: { OwnerUser: true, Alpha: true },
      communityId: 'new-jersey'
    }),
    false,
    'future public read scope: Schedule hides selected-community rows with partners outside selected community'
  );
  assertEqual(
    sandbox.schedulePreviewAllowsTrade({
      organizer: 'OwnerUser',
      participants: { OwnerUser: true, UsernameOnly: true }
    }),
    false,
    'future public read scope: Schedule treats missing communityId rows as nyc and hides them in non-nyc public selection'
  );
  // offerInReadScope under flag-on public-selected-community ('new-jersey'), owner preview off.
  assertEqual(
    sandbox.offerInReadScope({ from: 'OwnerUser', communityId: 'new-jersey' }, 'UsernameOnly'),
    true,
    'future public read scope: offerInReadScope allows selected-community offers between selected-community members'
  );
  assertEqual(
    sandbox.offerInReadScope({ from: 'Alpha', communityId: 'nyc' }, 'OwnerUser'),
    false,
    'future public read scope: offerInReadScope rejects offers stamped with a different communityId than the public selection'
  );
  assertEqual(
    sandbox.offerInReadScope({ from: 'OwnerUser' }, 'UsernameOnly'),
    false,
    'future public read scope: offerInReadScope defaults missing offer.communityId to nyc and hides it in non-nyc public selection'
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
