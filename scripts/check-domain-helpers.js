#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const context = {
  console,
  window: {}
};
context.globalThis = context;

vm.createContext(context);

function loadBrowserScript(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function deepEq(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

[
  'js/domain/priorities.js',
  'js/ui/badges.js',
  'js/domain/username.js',
  'js/domain/trainerNames.js',
  'js/domain/priorityValues.js',
  'js/domain/scheduleDates.js',
  'js/domain/pokemonSearchTerms.js',
  'js/domain/pokemonEntryRules.js',
  'js/domain/pokemonGoSearchSyntax.js',
  'js/domain/searchStrings.js',
  'js/ui/stringHtml.js',
  'js/domain/scheduleEventRules.js',
  'js/domain/scheduleTradeRules.js',
  'js/domain/pokemonKeys.js',
  'js/domain/fuzzyText.js',
  'js/domain/autocompleteText.js',
  'js/domain/autocompleteMatching.js',
  'js/domain/autocompleteRanking.js',
  'js/domain/relativeTime.js',
  'js/domain/spriteSlugs.js',
  'js/utils/textSafety.js',
  'js/ui/stringPanels.js',
  'js/ui/emptyState.js'
].forEach(loadBrowserScript);

const domain = context.window.PogoDomain;
const utils = context.window.PogoUtils;
const ui = context.window.PogoUi;

assert(domain, 'window.PogoDomain namespace should exist');
assert(utils, 'window.PogoUtils namespace should exist');
assert(ui, 'window.PogoUi namespace should exist');
assert(domain.priorities, 'priorities namespace should exist');
assert(ui.badges, 'badges namespace should exist');
assert(domain.username, 'username namespace should exist');
assert(domain.trainerNames, 'trainerNames namespace should exist');
assert(domain.priorityValues, 'priorityValues namespace should exist');
assert(domain.scheduleDates, 'scheduleDates namespace should exist');
assert(domain.pokemonSearchTerms, 'pokemonSearchTerms namespace should exist');
assert(domain.pokemonEntryRules, 'pokemonEntryRules namespace should exist');
assert(domain.pokemonGoSearchSyntax, 'pokemonGoSearchSyntax namespace should exist');
assert(domain.searchStrings, 'searchStrings namespace should exist');
assert(domain.scheduleEventRules, 'scheduleEventRules namespace should exist');
assert(domain.scheduleTradeRules, 'scheduleTradeRules namespace should exist');
assert(domain.pokemonKeys, 'pokemonKeys namespace should exist');
assert(domain.fuzzyText, 'fuzzyText namespace should exist');
assert(domain.autocompleteText, 'autocompleteText namespace should exist');
assert(domain.autocompleteMatching, 'autocompleteMatching namespace should exist');
assert(domain.autocompleteRanking, 'autocompleteRanking namespace should exist');
assert(domain.relativeTime, 'relativeTime namespace should exist');
assert(domain.spriteSlugs, 'spriteSlugs namespace should exist');
assert(utils.textSafety, 'textSafety namespace should exist');
assert(ui.stringHtml, 'stringHtml namespace should exist');
assert(ui.stringPanels, 'stringPanels namespace should exist');
assert(ui.emptyState, 'emptyState namespace should exist');

// --- priorities ---
const { priLabel, priName, listLabel, sortEntries } = domain.priorities;
eq(priLabel('H'), 'High', 'priLabel should resolve H');
eq(priName('M'), 'M - Medium', 'priName should resolve M');
eq(listLabel('wishlist'), 'Trades', 'listLabel should resolve wishlist');
deepEq(
  sortEntries([{ p: 'L', user: 'a' }, { p: 'H', user: 'a' }, { p: '?', user: 'a' }, { p: 'M', user: 'a' }]).map(e => e.p),
  ['H', 'M', 'L', '?'],
  'sortEntries should order by priority with unknown priority last'
);
deepEq(
  sortEntries([{ p: 'H', user: 'Bob' }, { p: 'H', user: 'alice' }, { p: 'H', user: 'Charlie' }]).map(e => e.user),
  ['alice', 'Bob', 'Charlie'],
  'sortEntries should break ties on user case-insensitively'
);
deepEq(
  sortEntries([{ p: 'H', user: 'a', mod: 'zzz' }, { p: 'H', user: 'a', mod: 'aaa' }, { p: 'H', user: 'a' }]).map(e => String(e.mod || '')),
  ['', 'aaa', 'zzz'],
  'sortEntries should break further ties on mod, with missing mod first'
);
const sortInput = [{ p: 'L', user: 'a' }, { p: 'H', user: 'a' }];
const sortOutput = sortEntries(sortInput);
assert(sortOutput !== sortInput, 'sortEntries should return a new array, not mutate in place');
eq(sortInput[0].p, 'L', 'sortEntries should leave the input array order unchanged');
eq(sortOutput[0].p, 'H', 'sortEntries should sort the returned copy');

// --- badges ---
eq(ui.badges.priBadge('H'), '🔴 High', 'priBadge should render high priority snapshot');
eq(ui.badges.priBadge('M'), '🟡 Medium', 'priBadge should render medium priority snapshot');
eq(ui.badges.priBadge('L'), '🟢 Low', 'priBadge should render low priority snapshot');
eq(ui.badges.priBadge('X'), 'X', 'priBadge should preserve unknown priority behavior');
eq(ui.badges.priBadge(''), '', 'priBadge should preserve blank priority behavior');
eq(ui.badges.priBadge(null), 'null', 'priBadge should preserve null priority behavior');
eq(
  ui.badges.diffBadgeHtml({ firstVisit: true, added: [], removed: [], changed: [] }),
  '',
  'diffBadgeHtml should render nothing on first visit'
);
eq(
  ui.badges.diffBadgeHtml({ firstVisit: false, added: [], removed: [], changed: [] }),
  '',
  'diffBadgeHtml should render nothing when there are no changes'
);
eq(
  ui.badges.diffBadgeHtml({ firstVisit: false, added: ['a'], removed: [], changed: [] }),
  '<span class="user-str-diff-badge added">+1</span>',
  'diffBadgeHtml should render added snapshot'
);
const removedDiffSnapshot = ui.badges.diffBadgeHtml({ firstVisit: false, added: [], removed: ['a', 'b'], changed: [] });
eq(
  removedDiffSnapshot,
  '<span class="user-str-diff-badge removed">−2</span>',
  'diffBadgeHtml should render removed snapshot with real minus'
);
assert(removedDiffSnapshot.includes('−2'), 'diffBadgeHtml removed snapshot should contain the real minus character');
assert(!removedDiffSnapshot.includes('-2'), 'diffBadgeHtml removed snapshot should not contain ASCII hyphen minus');
eq(
  ui.badges.diffBadgeHtml({ firstVisit: false, added: [], removed: [], changed: ['a', 'b', 'c'] }),
  '<span class="user-str-diff-badge">~3</span>',
  'diffBadgeHtml should render changed snapshot'
);
eq(
  ui.badges.diffBadgeHtml({ firstVisit: false, added: ['a'], removed: ['b', 'c'], changed: ['d'] }),
  '<span class="user-str-diff-badge added">+1</span><span class="user-str-diff-badge removed">−2</span><span class="user-str-diff-badge">~1</span>',
  'diffBadgeHtml should preserve added removed changed ordering'
);

// --- username ---
const { alphaCompare } = domain.username;
assert(alphaCompare('a2', 'a10') < 0, 'alphaCompare should sort natural numeric suffixes');
eq(alphaCompare('Mazer', 'mazer'), 0, 'alphaCompare should be case-insensitive');

// --- trainerNames ---
const { trainerNameParts, normalizeTrainerName, auditTrainerNames } = domain.trainerNames;
eq(normalizeTrainerName('TrainerOne'), 'trainerone', 'normalizeTrainerName should lowercase deterministically');
eq(normalizeTrainerName('  TrainerOne  '), 'trainerone', 'normalizeTrainerName should trim outer whitespace');
eq(normalizeTrainerName('Ｔｒａｉｎｅｒ１'), 'trainer1', 'normalizeTrainerName should apply NFKC');
eq(normalizeTrainerName('Ace-007!'), 'ace-007!', 'normalizeTrainerName should preserve punctuation and digits');
eq(normalizeTrainerName('Ace  007'), 'ace  007', 'normalizeTrainerName should preserve internal spacing');
assert(normalizeTrainerName('Ace') !== normalizeTrainerName('Аce'), 'normalizeTrainerName should not merge Latin and Cyrillic lookalikes');
deepEq(
  trainerNameParts('  PogoName  '),
  {
    originalValue: '  PogoName  ',
    trainerName: 'PogoName',
    nfkcTrainerName: 'PogoName',
    normalizedTrainerName: 'pogoname',
    changedByTrimming: true,
    changedByNfkc: false,
    valid: true
  },
  'trainerNameParts should preserve original and display values'
);
eq(auditTrainerNames(['Ace', ' ACE ']).summary.collisionGroups, 1, 'auditTrainerNames should detect normalized collisions');

// --- priorityValues ---
const { parsePri, priValue, entryGender } = domain.priorityValues;
deepEq(
  parsePri('H[lucky][shiny][xxl](female)'),
  { p: 'H', mod: 'female', lucky: true, xxl: true, xxs: false, shiny: true },
  'parsePri should parse bracket flags and gender modifier'
);
deepEq(
  parsePri('M(shiny f)'),
  { p: 'M', mod: 'f', lucky: false, xxl: false, xxs: false, shiny: true },
  'parsePri should lift shiny out of modifier text'
);
eq(priValue('L', 'm', false, false, true, false), 'L[xxs](m)', 'priValue should serialize flags and modifier');
eq(entryGender('female'), 'f', 'entryGender should normalize female');

// --- scheduleDates ---
const {
  isoDate,
  parseIsoDate,
  startOfWeek,
  addDays,
  WKDS
} = domain.scheduleDates;
eq(isoDate(new Date(2026, 4, 7)), '2026-05-07', 'isoDate should preserve local date parts');
const parsed = parseIsoDate('2026-05-07');
eq(parsed.getFullYear(), 2026, 'parseIsoDate should preserve local year');
eq(parsed.getMonth(), 4, 'parseIsoDate should preserve local month');
eq(parsed.getDate(), 7, 'parseIsoDate should preserve local day');
eq(isoDate(startOfWeek(new Date(2026, 4, 27))), '2026-05-24', 'startOfWeek should return Sunday');
eq(isoDate(addDays(new Date(2026, 4, 24), 6)), '2026-05-30', 'addDays should add local days');
assert(Array.isArray(WKDS) && WKDS.length === 7, 'WKDS should contain seven labels');

// --- pokemonSearchTerms ---
const {
  regionalFormPrefix,
  regionalFormTerm,
  regionTermFromDex,
  dexSearchTerm,
  castformTypeFilter,
  modSearchFilters,
  modFromSearchFilters,
  castformTypeFromSearchFilters,
  formVariantFilter,
  formVariantFromSearchFilters
} = domain.pokemonSearchTerms;
eq(regionalFormPrefix('A-Raichu'), 'A', 'regionalFormPrefix should find A prefix');
eq(regionalFormTerm('G-Corsola'), 'galar', 'regionalFormTerm should resolve G prefix');
eq(regionTermFromDex(25), 'kanto', 'regionTermFromDex should resolve Kanto');
eq(regionTermFromDex(900), 'hisui', 'regionTermFromDex should resolve Hisui');
eq(dexSearchTerm({ name: 'A-Raichu', no: 26 }, {}), 'alola&26', 'dexSearchTerm should include Alola qualifier');
eq(dexSearchTerm({ name: 'P-Tauros (Aqua)', no: 128 }, {}), 'paldea&128', 'dexSearchTerm should include Paldea qualifier');
eq(dexSearchTerm({ name: 'Raichu', no: 26, region: 'K' }, { 26: true }), 'kanto&26', 'dexSearchTerm should qualify base Kanto entries when dex has regional forms');
eq(dexSearchTerm({ name: 'Raichu', no: 26 }, { 26: true }), 'kanto&26', 'dexSearchTerm should fallback to dex region for base entries with regional forms');
eq(dexSearchTerm({ name: 'Raichu', no: 26 }, {}), '26', 'dexSearchTerm should leave base entries unqualified when dex has no regional forms');
eq(castformTypeFilter({ name: 'Castform (Snowy)', no: 351 }, ''), 'ice', 'castformTypeFilter should resolve Snowy');
eq(castformTypeFilter({ name: 'Castform', no: 351 }, 'rainy'), 'water', 'castformTypeFilter should resolve rainy modifier');
eq(castformTypeFilter({ name: 'Castform', no: 351 }, 'sun'), 'fire', 'castformTypeFilter should resolve sun modifier');
eq(castformTypeFilter({ name: 'Castform', no: 351 }, 'plain'), 'normal', 'castformTypeFilter should resolve plain modifier');
deepEq(modSearchFilters('female xxs'), ['female', 'xxs'], 'modSearchFilters should parse female and xxs');
deepEq(modSearchFilters('shiny male xxl'), ['shiny', 'male', 'xxl'], 'modSearchFilters should parse shiny, male, and xxl');
eq(modFromSearchFilters(['female', 'xxs']), 'f', 'modFromSearchFilters should prefer female');
eq(modFromSearchFilters(['male', 'xxl']), 'm', 'modFromSearchFilters should prefer male');
eq(castformTypeFromSearchFilters(['water', 'female']), 'water', 'castformTypeFromSearchFilters should find water');
eq(castformTypeFromSearchFilters(['normal', 'xxl']), 'normal', 'castformTypeFromSearchFilters should find normal');
eq(formVariantFilter({ name: 'Basculin (White Stripe)', no: 550 }, 'white'), '', 'formVariantFilter should preserve current empty qualifier behavior');
eq(formVariantFromSearchFilters(['white']), '', 'formVariantFromSearchFilters should preserve current empty qualifier behavior');

// --- pokemonEntryRules ---
const {
  uniqueEntries,
  costumeDedupeKey,
  isTradeableForWishlist,
  maxTypeForEntry,
  MAX_TYPE_SEARCH,
  entrySearchFilters
} = domain.pokemonEntryRules;
deepEq(
  uniqueEntries([{ name: 'Bulbasaur', no: 1 }, { name: 'Charmander', no: 4 }], [{ name: 'Bulbasaur', no: 999 }]),
  [{ name: 'Bulbasaur', no: 1 }, { name: 'Charmander', no: 4 }],
  'uniqueEntries should preserve first occurrence when deduping'
);
deepEq(
  uniqueEntries([{ name: 'Squirtle' }], [{ name: 'Squirtle' }, { name: 'Caterpie' }]).map(e => e.name),
  ['Squirtle', 'Caterpie'],
  'uniqueEntries should dedupe duplicate names across groups'
);
deepEq(
  uniqueEntries([{ name: 'Unown (?)', no: 201 }], [{ name: 'Unown (!)', no: 201 }]).map(e => e.name),
  ['Unown (?)', 'Unown (!)'],
  'uniqueEntries should preserve distinct Unown form names'
);
eq(costumeDedupeKey({ no: 25, name: 'Pikachu' }), '25|pikachu', 'costumeDedupeKey should normalize plain entries');
eq(costumeDedupeKey({ no: 201, displayName: 'Unown (?)' }), '201|unown qmark', 'costumeDedupeKey should preserve Unown question form');
eq(costumeDedupeKey({ no: 201, displayName: 'Unown (!)' }), '201|unown exclaim', 'costumeDedupeKey should preserve Unown exclamation form');
eq(
  costumeDedupeKey({ no: 222, name: 'Galarian Corsola Pink Sunglasses' }),
  '222|g corsola pink sunglasses',
  'costumeDedupeKey should preserve current regional shorthand behavior'
);
eq(isTradeableForWishlist({ name: 'Mew' }), false, 'isTradeableForWishlist should block untradeable Mythicals');
eq(isTradeableForWishlist({ name: 'Deoxys (Attack)' }), false, 'isTradeableForWishlist should block current Deoxys forms');
eq(isTradeableForWishlist({ name: 'Meltan' }), true, 'isTradeableForWishlist should preserve current Meltan behavior');
eq(isTradeableForWishlist({ name: 'Melmetal' }), true, 'isTradeableForWishlist should preserve current Melmetal behavior');
eq(isTradeableForWishlist({ name: 'Giratina (Origin)' }), true, 'isTradeableForWishlist should allow normal legendary entries');
eq(isTradeableForWishlist(null), true, 'isTradeableForWishlist should preserve null edge behavior');
eq(isTradeableForWishlist({}), true, 'isTradeableForWishlist should preserve blank object edge behavior');
eq(maxTypeForEntry(null), '', 'maxTypeForEntry should return empty for null entry');
eq(maxTypeForEntry({}), '', 'maxTypeForEntry should return empty for blank entry');
eq(maxTypeForEntry({ name: 'Charizard' }, 'gmax'), 'gmax', 'maxTypeForEntry should honor explicit gmax type argument');
eq(maxTypeForEntry({ name: 'Charizard' }, 'dynamax'), 'dynamax', 'maxTypeForEntry should honor explicit dynamax type argument');
eq(maxTypeForEntry({ name: 'Charizard', maxType: 'gmax' }), 'gmax', 'maxTypeForEntry should pass through entry.maxType');
eq(maxTypeForEntry({ name: 'Charizard', maxType: 'dynamax' }, ''), 'dynamax', 'maxTypeForEntry should pass through entry.maxType when type arg is blank');
eq(maxTypeForEntry({ name: 'Venusaur (Gigantamax)' }), 'gmax', 'maxTypeForEntry should detect Gigantamax from name');
eq(maxTypeForEntry({ displayName: 'Gigantamax Lapras' }), 'gmax', 'maxTypeForEntry should detect Gigantamax from displayName');
eq(maxTypeForEntry({ name: 'Excadrill (Dynamax)' }), 'dynamax', 'maxTypeForEntry should detect Dynamax from name');
eq(maxTypeForEntry({ dn: 'Snorlax Dynamax' }), 'dynamax', 'maxTypeForEntry should scan the dn field');
eq(maxTypeForEntry({ name: 'Pikachu' }), '', 'maxTypeForEntry should return empty for a plain entry');
eq(maxTypeForEntry({ name: 'Pikachu' }, 'sparkle'), '', 'maxTypeForEntry should ignore an unrecognized type argument');
eq(maxTypeForEntry({ name: 'Pikachu', maxType: 'frenzy' }), 'frenzy', 'maxTypeForEntry should pass through an unrecognized entry.maxType verbatim');

// entrySearchFilters composes modSearchFilters + maxTypeForEntry/MAX_TYPE_SEARCH + castform/form filters
deepEq(MAX_TYPE_SEARCH, { dynamax: 'dynamax', gmax: 'gigantamax' }, 'MAX_TYPE_SEARCH map should be exported intact');
deepEq(entrySearchFilters({ no: 1, name: 'Bulbasaur' }, ''), [], 'entrySearchFilters: plain wishlist entry yields no filters');
deepEq(entrySearchFilters({ no: 1, name: 'Bulbasaur' }, 'shiny female'), ['shiny', 'female'], 'entrySearchFilters: mod-only filters pass through in order');
deepEq(entrySearchFilters({ no: 1, name: 'Bulbasaur', maxType: 'dynamax' }, 'shiny'), ['dynamax', 'shiny'], 'entrySearchFilters: dynamax max-type is unshifted ahead of mod filters');
deepEq(entrySearchFilters({ no: 1, name: 'Bulbasaur', maxType: 'gmax' }, ''), ['gigantamax'], 'entrySearchFilters: gmax max-type maps to gigantamax');
deepEq(entrySearchFilters({ no: 351, name: 'Castform (Snowy)' }, ''), ['ice'], 'entrySearchFilters: castform variant resolves to its type filter');
deepEq(entrySearchFilters({ no: 550, name: 'Basculin' }, ''), [], 'entrySearchFilters: form-variant path currently adds nothing (no enabled form cases)');
deepEq(entrySearchFilters({ no: 351, name: 'Castform (Snowy)', maxType: 'dynamax' }, 'shiny xxl'), ['ice', 'dynamax', 'shiny', 'xxl'], 'entrySearchFilters: ordering — castform unshifted to front, then max-type, then mod filters');
deepEq(entrySearchFilters({}, ''), [], 'entrySearchFilters: empty entry preserves current empty-array behavior');

// --- searchStrings ---
const {
  PREFILTER,
  POGO_STR_LIMIT,
  dexStringFromNumbers,
  stringFromSearchItems,
  stringParts,
  searchPartSort,
  combineStrings,
  combinedStringOptions,
  strLenInfo
} = domain.searchStrings;
eq(PREFILTER, '!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&', 'PREFILTER should stay exact');
eq(dexStringFromNumbers([26, 1, 26]), PREFILTER + '1,26', 'dexStringFromNumbers should sort and dedupe dex numbers');
eq(
  stringFromSearchItems([{ term: '26' }, { term: 'alola&27' }]),
  PREFILTER + '26,27',
  'stringFromSearchItems should preserve existing dex-only extraction from item terms'
);
deepEq(stringParts(PREFILTER + '26, alola&27'), ['27'], 'stringParts should keep only numeric dex terms from the final generated clause');
deepEq(stringParts('1,2'), ['1', '2'], 'stringParts should split strings without PREFILTER');
assert(searchPartSort('2', '10') < 0, 'searchPartSort should compare numeric terms naturally');
assert(searchPartSort('alola&26', 'galar&52') < 0, 'searchPartSort should fallback to locale order when numeric dex values differ predictably');
assert(searchPartSort('27', 'alola&27') < 0, 'searchPartSort should order equal dex terms by full term text');
eq(
  combineStrings({ H: PREFILTER + '1,4', M: PREFILTER + '4,7' }, ['H', 'M']),
  PREFILTER + '1,4,7',
  'combineStrings should merge, dedupe, and sort selected priority strings'
);
eq(
  combinedStringOptions({ H: PREFILTER + '1', M: PREFILTER + '4' }).length,
  2,
  'combinedStringOptions should offer High + Medium and All priorities when H and M exist'
);
deepEq(strLenInfo('abc'), { len: 3, cls: '' }, 'strLenInfo should classify short strings as safe');
eq(strLenInfo('x'.repeat(Math.floor(POGO_STR_LIMIT * 0.85))).cls, '', 'strLenInfo should stay safe at the warn boundary floor');
eq(strLenInfo('x'.repeat(Math.floor(POGO_STR_LIMIT * 0.85) + 1)).cls, 'warn', 'strLenInfo should warn just above the warn boundary');
eq(strLenInfo('x'.repeat(POGO_STR_LIMIT)).cls, 'warn', 'strLenInfo should warn at the hard limit');
eq(strLenInfo('x'.repeat(POGO_STR_LIMIT + 1)).cls, 'danger', 'strLenInfo should mark strings over the hard limit as danger');
assert(strLenInfo('x'.repeat(POGO_STR_LIMIT + 1)).cls !== '', 'strLenInfo should classify over-limit strings');

// --- stringHtml ---
eq(
  ui.stringHtml.strLenHtml('abc'),
  '<span class="str-meta " title="PoGo search limit is ~1500 chars">3/1500</span>',
  'strLenHtml should preserve blank class spacing'
);
eq(
  ui.stringHtml.strLenHtml('x'.repeat(1276)),
  '<span class="str-meta warn" title="PoGo search limit is ~1500 chars">1276/1500</span>',
  'strLenHtml should render warning snapshot'
);
eq(
  ui.stringHtml.strLenHtml('x'.repeat(1501)),
  '<span class="str-meta danger" title="PoGo search limit is ~1500 chars">1501/1500</span>',
  'strLenHtml should render danger snapshot'
);
eq(ui.stringHtml.strWarnHtml('abc'), '', 'strWarnHtml should render no banner for safe strings');
eq(
  ui.stringHtml.strWarnHtml('x'.repeat(1276)),
  "<div class=\"str-warn-banner\">⚠️ Approaching PoGo's ~1500 char limit (1276). Consider splitting soon.</div>",
  'strWarnHtml should render warning snapshot'
);
eq(
  ui.stringHtml.strWarnHtml('x'.repeat(1501)),
  "<div class=\"str-warn-banner danger\">⚠️ This string exceeds PoGo's ~1500 char limit (1501). It will be truncated in-game. Consider splitting into multiple priority lists.</div>",
  'strWarnHtml should render danger snapshot'
);

// --- scheduleEventRules ---
const {
  collectEventBonusTexts,
  eventNumberTokenToInt,
  parseSpecialTradeBonus,
  classifyEvent,
  getEventId
} = domain.scheduleEventRules;
eq(eventNumberTokenToInt('three'), 3, 'eventNumberTokenToInt should parse word numbers');
eq(eventNumberTokenToInt('7'), 7, 'eventNumberTokenToInt should parse numeric strings');
deepEq(
  parseSpecialTradeBonus(['You can make one additional special trade']),
  { bonus: 1, text: 'You can make one additional special trade', kind: 'additional' },
  'parseSpecialTradeBonus should parse one additional special trade'
);
deepEq(
  parseSpecialTradeBonus(['up to three special trades']),
  { bonus: 2, text: 'up to three special trades', kind: 'total' },
  'parseSpecialTradeBonus should preserve current total-to-bonus behavior'
);
deepEq(collectEventBonusTexts({ extraData: {} }), [], 'collectEventBonusTexts should preserve empty extraData behavior');
deepEq(
  collectEventBonusTexts({ extraData: [{ text: 'first bonus' }, { description: 'second bonus' }, { text: 'first bonus' }] }),
  ['first bonus', 'second bonus'],
  'collectEventBonusTexts should walk arrays and dedupe repeated text'
);
eq(parseSpecialTradeBonus(['']), null, 'parseSpecialTradeBonus should ignore blank bonus text');
deepEq(
  classifyEvent({ extraData: { text: 'two additional special trades' } }),
  { bonus: 2, bonusType: 'special', ambiguous: false, bonusText: 'two additional special trades', bonusKind: 'additional' },
  'classifyEvent should classify explicit special trade bonuses'
);
deepEq(
  classifyEvent({ extraData: { text: 'raid bonuses only' } }),
  { bonus: 0, bonusType: 'special', ambiguous: true, bonusText: '' },
  'classifyEvent should leave non-special-trade events ambiguous'
);
deepEq(
  classifyEvent(null),
  { bonus: 0, bonusType: 'special', ambiguous: true, bonusText: '' },
  'classifyEvent should preserve null event behavior'
);
deepEq(
  classifyEvent({ extraData: [{ text: 'up to three special trades' }] }),
  { bonus: 2, bonusType: 'special', ambiguous: false, bonusText: 'up to three special trades', bonusKind: 'total' },
  'classifyEvent should preserve current array text handling for total special trades'
);
eq(getEventId({ eventID: 'abc', name: 'x', start: 1 }), 'abc', 'getEventId should prefer eventID');
eq(getEventId({ name: 'Event', start: 123 }), 'Event_123', 'getEventId should fallback to name and start');

// --- scheduleTradeRules ---
const {
  externalTradePartners,
  parseExternalTradePartners,
  scheduledTradeQuantity,
  summarizeScheduledTrades
} = domain.scheduleTradeRules;
deepEq(
  externalTradePartners({ externalPartners: [' Alice ', '', null, 'Bob', 'Cara', 'Dan', 'Eve', 'Fox', 'Gina'] }),
  ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Fox'],
  'externalTradePartners should trim, filter, and cap partner arrays'
);
deepEq(
  externalTradePartners({ externalPartner: ' Solo ' }),
  ['Solo'],
  'externalTradePartners should preserve legacy single external partner'
);
deepEq(
  parseExternalTradePartners(' Alice, , Bob, Cara, Dan, Eve, Fox, Gina '),
  ['Alice', 'Bob', 'Cara', 'Dan', 'Eve', 'Fox'],
  'parseExternalTradePartners should trim, filter, and cap comma-separated names'
);
eq(scheduledTradeQuantity({ type: 'regular', regularCount: 25 }), 25, 'scheduledTradeQuantity should use regularCount for regular trades');
eq(scheduledTradeQuantity({ type: 'regular', regularCount: 999 }), 100, 'scheduledTradeQuantity should cap regular trades at 100');
eq(scheduledTradeQuantity({ type: 'regular', regularCount: 0 }), 1, 'scheduledTradeQuantity should fallback to 1 for invalid regular counts');
eq(scheduledTradeQuantity({ type: 'regular' }), 1, 'scheduledTradeQuantity should fallback to 1 when regularCount is missing');
eq(scheduledTradeQuantity({ type: 'regular', regularCount: '12 trades' }), 12, 'scheduledTradeQuantity should preserve parseInt behavior for regularCount text');
eq(scheduledTradeQuantity(null), 1, 'scheduledTradeQuantity should preserve null trade behavior');
eq(scheduledTradeQuantity({ type: 'special', regularCount: 25 }), 1, 'scheduledTradeQuantity should count non-regular trades as 1');
const tradeRows = [
  { type: 'regular', status: 'scheduled', regularCount: 5 },
  { type: 'regular', status: 'completed', regularCount: 3 },
  { type: 'special', status: 'completed' },
  { type: 'remote', status: 'scheduled' },
  { status: 'cancelled', regularCount: 2 },
  { type: 'regular', status: 'reserved', regularCount: 4 },
  { type: 'regular' }
];
const summary = summarizeScheduledTrades(tradeRows);
eq(summary.special, 1, 'summarizeScheduledTrades should count special trades');
eq(summary.regular, 15, 'summarizeScheduledTrades should count regular quantities, including current cancelled/reserved-row behavior');
eq(summary.remote, 1, 'summarizeScheduledTrades should count remote trades');
eq(summary.total, 17, 'summarizeScheduledTrades should total trade quantities');
eq(summary.scheduled, 5, 'summarizeScheduledTrades should count scheduled rows, not regular quantities');
eq(summary.completed, 2, 'summarizeScheduledTrades should count completed rows, not regular quantities');
deepEq(
  summary.byStatus,
  {
    special: { scheduled: 0, completed: 1 },
    regular: { scheduled: 12, completed: 3 },
    remote: { scheduled: 1, completed: 0 }
  },
  'summarizeScheduledTrades should preserve current byStatus quantity behavior'
);
eq(summary.trades, tradeRows, 'summarizeScheduledTrades should return the original trades array reference');
deepEq(
  externalTradePartners({ externalPartners: ['', '  ', 0, false, 'Bob'] }),
  ['Bob'],
  'externalTradePartners should filter falsy malformed array partners before coercion'
);
deepEq(parseExternalTradePartners(' , Alice,,  Bob , , '), ['Alice', 'Bob'], 'parseExternalTradePartners should drop blank malformed chunks');

// --- pokemonKeys ---
const {
  _normGender,
  splitHaveKey,
  joinHaveKey,
  totalQtyForName,
  haveEntryInfo,
  haveEntryValue
} = domain.pokemonKeys;
eq(_normGender('female'), 'f', '_normGender should normalize female');
eq(_normGender('♀'), 'f', '_normGender should normalize female symbol');
eq(_normGender('male'), 'm', '_normGender should normalize male');
eq(_normGender('♂'), 'm', '_normGender should normalize male symbol');
eq(_normGender('unknown'), '', '_normGender should blank unknown gender text');
deepEq(splitHaveKey('Heracross::m'), { name: 'Heracross', gender: 'm' }, 'splitHaveKey should split male suffix');
deepEq(splitHaveKey("Farfetch'd::x"), { name: "Farfetch'd::x", gender: '' }, 'splitHaveKey should preserve invalid suffixes');
deepEq(splitHaveKey("Farfetch'd::f::m"), { name: "Farfetch'd::f", gender: 'm' }, 'splitHaveKey should split only the final valid gender suffix');
deepEq(splitHaveKey('Heracross::m::x'), { name: 'Heracross::m::x', gender: '' }, 'splitHaveKey should preserve keys with invalid final suffixes');
eq(joinHaveKey('Heracross', 'female'), 'Heracross::f', 'joinHaveKey should append normalized female suffix');
eq(joinHaveKey('Heracross', ''), 'Heracross', 'joinHaveKey should leave blank gender off');
eq(joinHaveKey('', 'female'), '::f', 'joinHaveKey should preserve current blank-name female key behavior');
eq(joinHaveKey('', ''), '', 'joinHaveKey should preserve current blank-name genderless key behavior');
eq(
  totalQtyForName({ Heracross: 2, 'Heracross::m': 3, 'Heracross::f': 4 }, 'Heracross'),
  9,
  'totalQtyForName should aggregate genderless, male, and female keys'
);
deepEq(
  haveEntryInfo(7),
  { qty: 7, mirrorOnly: false, dontNeedBack: false, giveaway: false, note: '', mode: 'any' },
  'haveEntryInfo should preserve numeric entries as any mode'
);
deepEq(
  haveEntryInfo({ qty: 12, mirrorOnly: true, dontNeedBack: true }),
  { qty: 12, mirrorOnly: true, dontNeedBack: false, giveaway: false, note: '', mode: 'mirror' },
  'haveEntryInfo should preserve mirror mode precedence over fair trade'
);
deepEq(
  haveEntryInfo({ qty: 1000, giveaway: true, note: 'x'.repeat(141) }),
  { qty: 999, mirrorOnly: false, dontNeedBack: false, giveaway: true, note: 'x'.repeat(140), mode: 'giveaway' },
  'haveEntryInfo should clamp qty and note length'
);
deepEq(haveEntryValue(5, 0, { mode: 'mirror' }), { qty: 5, mirrorOnly: true }, 'haveEntryValue should preserve mirror shape');
deepEq(haveEntryValue(5, 0, { mode: 'giveaway', note: 'take it' }), { qty: 5, giveaway: true, note: 'take it' }, 'haveEntryValue should preserve giveaway note');
deepEq(haveEntryValue(0, { qty: 3, giveaway: true, note: 'old note' }, {}), { qty: 0, giveaway: true, note: 'old note' }, 'haveEntryValue should preserve previous object mode and note at zero quantity');
eq(haveEntryValue(0, { qty: 3, mirrorOnly: true }, { mode: 'any' }), 0, 'haveEntryValue should preserve direct zero any-mode behavior');
deepEq(
  haveEntryValue(4, { qty: 3, giveaway: true, note: 'old note' }, {}),
  { qty: 4, giveaway: true, note: 'old note' },
  'haveEntryValue should preserve previous mode and note when opts are blank'
);
deepEq(
  haveEntryValue(4, { qty: 3, giveaway: true, note: 'old note' }, { mode: 'giveaway', note: '' }),
  { qty: 4, giveaway: true },
  'haveEntryValue should remove previous notes when giveaway mode receives blank note'
);
deepEq(
  haveEntryValue(6, { qty: 3, giveaway: true, note: 'old note' }, { mode: 'dontNeedBack' }),
  { qty: 6, dontNeedBack: true },
  'haveEntryValue should drop notes outside giveaway mode'
);

// --- fuzzyText ---
const { _phoneticCode, _levenshtein } = domain.fuzzyText;
eq(_levenshtein('kitten', 'sitting'), 3, '_levenshtein should preserve classic edit distance behavior');
eq(_levenshtein('', 'abc'), 3, '_levenshtein should count insertions from empty source');
eq(_levenshtein('abc', ''), 3, '_levenshtein should count deletions to empty target');
eq(_levenshtein('same', 'same'), 0, '_levenshtein should return zero for equal strings');
eq(_phoneticCode('Pikachu'), 'pkch', '_phoneticCode should preserve current Pikachu normalization');
eq(_phoneticCode('PIKACHU'), 'pkch', '_phoneticCode should preserve case-insensitive normalization');
eq(_phoneticCode('Farfetch’d'), 'frftchd', '_phoneticCode should strip punctuation-like characters');
eq(_phoneticCode('Charizard'), 'chrzrd', '_phoneticCode should preserve current Pokemon-ish normalization');
eq(_phoneticCode('charzard'), 'chrzrd', '_phoneticCode should preserve current misspelling normalization');
eq(_phoneticCode(''), '', '_phoneticCode should preserve empty-string behavior');

// --- autocompleteText ---
const { normalizeAcText } = domain.autocompleteText;
eq(normalizeAcText('Pikachu'), 'pikachu', 'normalizeAcText should normalize plain names');
eq(normalizeAcText('pIkA'), 'pikachu', 'normalizeAcText should expand pika after case normalization');
eq(normalizeAcText('Pika Libre'), 'pikachu libre', 'normalizeAcText should expand pika aliases in phrases');
eq(normalizeAcText('pikapika'), 'pikapika', 'normalizeAcText should not expand embedded pika text');
eq(normalizeAcText('GMAX Charizard'), 'gigantamax charizard', 'normalizeAcText should expand gmax');
eq(normalizeAcText('Gigantamax Charizard'), 'gigantamax charizard', 'normalizeAcText should normalize gigantamax');
eq(normalizeAcText('gmaxed Charizard'), 'gmaxed charizard', 'normalizeAcText should preserve non-word-boundary gmax text');
eq(normalizeAcText('dmax Squirtle'), 'dynamax squirtle', 'normalizeAcText should expand dmax');
eq(normalizeAcText('Dynamax Squirtle'), 'dynamax squirtle', 'normalizeAcText should normalize dynamax');
eq(normalizeAcText('Flabébé (Blue Flower)'), 'flabebe blue flower', 'normalizeAcText should strip accents and punctuation');
eq(normalizeAcText('Pokémon'), 'pokemon', 'normalizeAcText should strip Pokemon accent');
eq(normalizeAcText('Unown (?)'), 'unown question', 'normalizeAcText should turn question mark into text');
eq(normalizeAcText('Unown (!)'), 'unown exclamation', 'normalizeAcText should turn exclamation mark into text');
eq(normalizeAcText('?!'), 'question exclamation', 'normalizeAcText should preserve question/exclamation token order');
eq(normalizeAcText('  Mr.   Mime  '), 'mr mime', 'normalizeAcText should trim and collapse spaces');
eq(normalizeAcText("Farfetch'd"), 'farfetch d', 'normalizeAcText should preserve current apostrophe split behavior');
eq(normalizeAcText('A-Raichu'), 'a raichu', 'normalizeAcText should collapse hyphenated names');
eq(normalizeAcText('Pikachu Ph.D.'), 'pikachu phd', 'normalizeAcText should collapse dotted PhD');
eq(normalizeAcText('Pikachu Ph D'), 'pikachu phd', 'normalizeAcText should collapse spaced PhD');
eq(normalizeAcText('Pikachu Ph_D'), 'pikachu phd', 'normalizeAcText should collapse underscored PhD');
eq(normalizeAcText(''), '', 'normalizeAcText should preserve empty string behavior');
eq(normalizeAcText(null), '', 'normalizeAcText should preserve null behavior');
eq(normalizeAcText(undefined), '', 'normalizeAcText should preserve undefined behavior');
eq(normalizeAcText(false), '', 'normalizeAcText should preserve false behavior');
eq(normalizeAcText(0), '', 'normalizeAcText should preserve zero behavior');
eq(normalizeAcText(25), '25', 'normalizeAcText should stringify truthy numbers');
eq(normalizeAcText({}), 'object object', 'normalizeAcText should preserve object stringification behavior');
eq(normalizeAcText(['Pika', 'Gmax']), 'pikachu gigantamax', 'normalizeAcText should preserve array stringification behavior');

// --- autocompleteMatching ---
const { AC_RESULT_LIMIT, acItemSearchText, acMatchScore } = domain.autocompleteMatching;
eq(AC_RESULT_LIMIT, 50, 'AC_RESULT_LIMIT should preserve current result cap');
eq(
  acItemSearchText({ name: 'Pikachu', dn: 'Pikachu', no: 25 }),
  'pikachu pikachu 25 25',
  'acItemSearchText should include normalized name, display name, and dex text'
);
assert(
  acItemSearchText({ name: 'Unown (?)', dn: 'Unown (?)', no: 201 }).includes('questionmark'),
  'acItemSearchText should include question-mark aliases for Unown (?)'
);
assert(
  acItemSearchText({ name: 'Unown (!)', dn: 'Unown (!)', no: 201 }).includes('exclamationmark'),
  'acItemSearchText should include exclamation-mark aliases for Unown (!)'
);
eq(
  acItemSearchText({ name: 'Pika Libre', dn: 'Pika Libre', no: 25 }),
  'pikachu libre pikachu libre 25 25',
  'acItemSearchText should preserve current pika alias expansion'
);
assert(
  acItemSearchText({ name: 'A-Raichu', dn: 'A-Raichu', no: 26 }).includes('26'),
  'acItemSearchText should include dex-number text when present'
);
eq(acMatchScore({ name: 'Pikachu', dn: 'Pikachu', no: 25 }, ''), -1, 'acMatchScore should reject blank queries');
eq(acMatchScore({ search: 'pikachu libre', no: 25 }, 'Pika Libre'), 1, 'acMatchScore should score exact normalized matches');
eq(acMatchScore({ search: 'pikachu libre', no: 25 }, 'pika'), 2, 'acMatchScore should score prefix matches');
eq(acMatchScore({ search: 'pikachu libre', no: 25 }, 'libre'), 3, 'acMatchScore should score contains matches');
eq(acMatchScore({ search: 'pikachu libre costume', no: 25 }, 'libre pika'), 10, 'acMatchScore should score token matches after exact/prefix/includes');
eq(acMatchScore({ search: 'pikachu 25', no: 25 }, '25'), 0, 'acMatchScore should score exact pure dex queries first');
eq(acMatchScore({ search: 'pikachu 25', no: 25 }, '2'), 1, 'acMatchScore should score pure dex prefixes');
eq(acMatchScore({ search: 'pikachu 25', no: 25 }, '999'), -1, 'acMatchScore should reject unmatched pure dex queries');
eq(acMatchScore({ search: 'pikachu libre', no: 25 }, 'raichu'), -1, 'acMatchScore should reject no-match text queries');

// --- autocompleteRanking ---
const { autocompleteDexSortValue, compareAutocompleteMatches, rankAutocompleteItems } = domain.autocompleteRanking;
eq(autocompleteDexSortValue({ no: 25 }), 25, 'autocompleteDexSortValue should parse numeric dex values');
eq(autocompleteDexSortValue({}), 9999, 'autocompleteDexSortValue should fallback for missing dex values');
eq(autocompleteDexSortValue({ no: null }), 9999, 'autocompleteDexSortValue should fallback for null dex values');
eq(autocompleteDexSortValue({ no: '' }), 9999, 'autocompleteDexSortValue should fallback for empty dex values');
eq(autocompleteDexSortValue({ no: '0' }), 9999, 'autocompleteDexSortValue should preserve parseInt zero fallback quirk');
eq(
  compareAutocompleteMatches(
    { e: { dn: 'Beta', no: 25 }, score: 1 },
    { e: { dn: 'Alpha', no: 25 }, score: 1 },
    { alphaTieBreak: false }
  ),
  0,
  'compareAutocompleteMatches should omit alpha sorting when alphaTieBreak is false'
);
deepEq(
  rankAutocompleteItems([{ name: 'Pikachu', dn: 'Pikachu', no: 25, search: 'pikachu' }], 'raichu'),
  [],
  'rankAutocompleteItems should filter no-match results'
);
deepEq(
  rankAutocompleteItems([
    { name: 'Libre', dn: 'Libre', no: 1, search: 'pikachu libre' },
    { name: 'Pikachu', dn: 'Pikachu', no: 25, search: 'pikachu' }
  ], 'pika').map(e => e.dn),
  ['Pikachu', 'Libre'],
  'rankAutocompleteItems should order by score before dex'
);
deepEq(
  rankAutocompleteItems([
    { name: 'Pikachu Z', dn: 'Zzz', no: 25, search: 'pikachu zzz' },
    { name: 'Pikachu A', dn: 'Aaa', no: 26, search: 'pikachu aaa' }
  ], 'pika').map(e => e.dn),
  ['Zzz', 'Aaa'],
  'rankAutocompleteItems should order equal scores by dex before alpha'
);
deepEq(
  rankAutocompleteItems([
    { name: 'Pikachu B', dn: 'Beta', no: 25, search: 'pikachu beta' },
    { name: 'Pikachu A', dn: 'Alpha', no: 25, search: 'pikachu alpha' }
  ], 'pika').map(e => e.dn),
  ['Alpha', 'Beta'],
  'rankAutocompleteItems should alpha-sort equal score and dex by default'
);
deepEq(
  rankAutocompleteItems([
    { name: 'Pikachu B', dn: 'Beta', no: 25, search: 'pikachu beta' },
    { name: 'Pikachu A', dn: 'Alpha', no: 25, search: 'pikachu alpha' }
  ], 'pika', { alphaTieBreak: false }).map(e => e.dn),
  ['Beta', 'Alpha'],
  'rankAutocompleteItems should preserve insertion order for equal score/dex when alpha tiebreak is disabled'
);
eq(
  rankAutocompleteItems(Array.from({ length: AC_RESULT_LIMIT + 5 }, (_, i) => ({ name: `Pikachu ${i}`, dn: `Pikachu ${i}`, no: 25, search: `pikachu ${i}` })), 'pika').length,
  AC_RESULT_LIMIT,
  'rankAutocompleteItems should use AC_RESULT_LIMIT by default'
);
eq(
  rankAutocompleteItems(Array.from({ length: 10 }, (_, i) => ({ name: `Pikachu ${i}`, dn: `Pikachu ${i}`, no: 25, search: `pikachu ${i}` })), 'pika', { limit: 6 }).length,
  6,
  'rankAutocompleteItems should honor a custom limit'
);
deepEq(
  rankAutocompleteItems([
    { name: 'Pikachu', dn: 'Pikachu', no: 25, search: 'pikachu 25' },
    { name: 'Ivysaur', dn: 'Ivysaur', no: 2, search: 'ivysaur 2' }
  ], '2').map(e => e.no),
  [2, 25],
  'rankAutocompleteItems should preserve pure-digit exact dex scoring over dex prefix scoring'
);
const rankInput = [
  { name: 'Pikachu B', dn: 'Beta', no: 25, search: 'pikachu beta' },
  { name: 'Pikachu A', dn: 'Alpha', no: 25, search: 'pikachu alpha' }
];
rankAutocompleteItems(rankInput, 'pika');
deepEq(rankInput.map(e => e.dn), ['Beta', 'Alpha'], 'rankAutocompleteItems should not mutate the input array order');

// --- relativeTime ---
// These helpers compute deltas against Date.now() internally, so tests build
// timestamps as (now - offset) and use mid-bucket offsets that stay safely
// away from boundaries, keeping results deterministic despite millisecond
// drift between this capture and the internal Date.now() call.
const { STALE_WARN, STALE_OLD, freshnessClass, freshnessLabel, freshnessColor, relativeTime } = domain.relativeTime;
const rtNow = Date.now();
const minsAgo = (m) => rtNow - m * 60000;
const hoursAgo = (h) => rtNow - h * 3600000;
const daysAgo = (d) => rtNow - d * 86400000;
const secsAgo = (s) => rtNow - s * 1000;

eq(STALE_WARN, 7, 'STALE_WARN should preserve current 7-day threshold');
eq(STALE_OLD, 30, 'STALE_OLD should preserve current 30-day threshold');

// freshnessClass: <7d fresh, 7d..<30d warn, >=30d stale, falsy stale
eq(freshnessClass(0), 'stale', 'freshnessClass should treat falsy ts as stale');
eq(freshnessClass(daysAgo(3)), 'fresh', 'freshnessClass should be fresh under 7 days');
eq(freshnessClass(daysAgo(6.9)), 'fresh', 'freshnessClass should be fresh just under 7 days');
eq(freshnessClass(daysAgo(7.1)), 'warn', 'freshnessClass should be warn just over 7 days');
eq(freshnessClass(daysAgo(15)), 'warn', 'freshnessClass should be warn between 7 and 30 days');
eq(freshnessClass(daysAgo(29)), 'warn', 'freshnessClass should be warn just under 30 days');
eq(freshnessClass(daysAgo(31)), 'stale', 'freshnessClass should be stale just over 30 days');

// freshnessLabel: minute/hour/day/week/month-ish ranges
eq(freshnessLabel(0), 'Never', 'freshnessLabel should treat falsy ts as Never');
eq(freshnessLabel(secsAgo(30)), 'Just now', 'freshnessLabel should say Just now under 2 minutes');
eq(freshnessLabel(minsAgo(1.5)), 'Just now', 'freshnessLabel should say Just now at 1 minute');
eq(freshnessLabel(minsAgo(5.5)), '5m ago', 'freshnessLabel should report minutes');
eq(freshnessLabel(minsAgo(59.5)), '59m ago', 'freshnessLabel should report 59 minutes');
eq(freshnessLabel(hoursAgo(3.5)), '3h ago', 'freshnessLabel should report hours');
eq(freshnessLabel(hoursAgo(23.5)), '23h ago', 'freshnessLabel should report 23 hours');
eq(freshnessLabel(daysAgo(3.5)), '3d ago', 'freshnessLabel should report days');
eq(freshnessLabel(daysAgo(6.5)), '6d ago', 'freshnessLabel should report 6 days');
eq(freshnessLabel(daysAgo(14.5)), '2w ago', 'freshnessLabel should report weeks');
eq(freshnessLabel(daysAgo(21.5)), '3w ago', 'freshnessLabel should report 3 weeks');
eq(freshnessLabel(daysAgo(60.5)), '2mo ago', 'freshnessLabel should report months');
eq(freshnessLabel(daysAgo(90.5)), '3mo ago', 'freshnessLabel should report 3 months');

// freshnessColor: fresh/warn/stale + unknown fallback
eq(freshnessColor('fresh'), 'var(--ok)', 'freshnessColor fresh should map to --ok');
eq(freshnessColor('warn'), 'var(--warn)', 'freshnessColor warn should map to --warn');
eq(freshnessColor('stale'), 'var(--danger)', 'freshnessColor stale should map to --danger');
eq(freshnessColor('unknown'), 'var(--muted)', 'freshnessColor should fall back to --muted');
eq(freshnessColor(''), 'var(--muted)', 'freshnessColor should fall back for empty input');

// relativeTime: just-now/minute/hour/day ranges (second-based deltas)
eq(relativeTime(0), '', 'relativeTime should return empty for falsy ts');
eq(relativeTime(secsAgo(30)), 'just now', 'relativeTime should say just now under a minute');
eq(relativeTime(secsAgo(90)), '1m ago', 'relativeTime should report minutes');
eq(relativeTime(minsAgo(59.5)), '59m ago', 'relativeTime should report 59 minutes');
eq(relativeTime(hoursAgo(3.5)), '3h ago', 'relativeTime should report hours');
eq(relativeTime(hoursAgo(23.5)), '23h ago', 'relativeTime should report 23 hours');
eq(relativeTime(daysAgo(2.5)), '2d ago', 'relativeTime should report days');

// --- spriteSlugs ---
const { padDex, normalizeCostumeLookupKey, pokemondbGoSpeciesSlug, normalizeSpriteKey } = domain.spriteSlugs;

eq(padDex(1), '001', 'padDex should zero-pad single digit');
eq(padDex(25), '025', 'padDex should zero-pad two digits');
eq(padDex(386), '386', 'padDex should leave three digits');
eq(padDex('25'), '025', 'padDex should accept numeric strings');
eq(padDex(0), '000', 'padDex should pad zero');
eq(padDex(''), '', 'padDex should return empty for empty string');
eq(padDex('abc'), '', 'padDex should return empty for non-numeric');
eq(padDex(undefined), '', 'padDex should return empty for undefined');

eq(normalizeCostumeLookupKey('Eevee Flower Crown'), 'eevee flower crown', 'normalizeCostumeLookupKey should lowercase');
eq(normalizeCostumeLookupKey('  PIKACHU   Party  '), 'pikachu party', 'normalizeCostumeLookupKey should trim and collapse whitespace');
eq(normalizeCostumeLookupKey(''), '', 'normalizeCostumeLookupKey should handle empty string');
eq(normalizeCostumeLookupKey(undefined), '', 'normalizeCostumeLookupKey should handle undefined');

eq(pokemondbGoSpeciesSlug('Pikachu'), 'pikachu', 'pokemondbGoSpeciesSlug should lowercase plain name');
eq(pokemondbGoSpeciesSlug("Farfetch'd"), 'farfetchd', 'pokemondbGoSpeciesSlug should strip apostrophe');
eq(pokemondbGoSpeciesSlug('Mr. Mime'), 'mr-mime', 'pokemondbGoSpeciesSlug should drop period and hyphenate space');
eq(pokemondbGoSpeciesSlug('Nidoran♀'), 'nidoran', 'pokemondbGoSpeciesSlug should strip gender symbol');
eq(pokemondbGoSpeciesSlug('Flabébé'), 'flabebe', 'pokemondbGoSpeciesSlug should strip accents');
eq(pokemondbGoSpeciesSlug('  Mime   Jr  '), 'mime-jr', 'pokemondbGoSpeciesSlug should trim and collapse to single hyphens');
eq(pokemondbGoSpeciesSlug(''), '', 'pokemondbGoSpeciesSlug should handle empty string');

eq(normalizeSpriteKey('Mr. Mime'), 'mr mime', 'normalizeSpriteKey should drop period and keep single space');
eq(normalizeSpriteKey('A-Raichu'), 'a raichu', 'normalizeSpriteKey should turn hyphen into space');
eq(normalizeSpriteKey('Nidoran♀'), 'nidoran', 'normalizeSpriteKey should strip gender symbol');
eq(normalizeSpriteKey('Porygon_Z.test-form'), 'porygon z test form', 'normalizeSpriteKey should collapse underscore/dot/hyphen separators');
eq(normalizeSpriteKey(''), '', 'normalizeSpriteKey should handle empty string');

// --- pokemondbSlug ---
const { pokemondbSlug, REGIONAL_SLUG_MAP } = domain.spriteSlugs;

deepEq(REGIONAL_SLUG_MAP, { A: 'alolan', G: 'galarian', H: 'hisuian', P: 'paldean' }, 'REGIONAL_SLUG_MAP should preserve region words');

// Regional prefix, no parenthetical (A/G/H/P)
eq(pokemondbSlug('A-Raichu', 'A-Raichu'), 'raichu-alolan', 'pokemondbSlug should expand Alolan prefix');
eq(pokemondbSlug('G-Meowth', 'G-Meowth'), 'meowth-galarian', 'pokemondbSlug should expand Galarian prefix');
eq(pokemondbSlug('H-Zorua', 'H-Zorua'), 'zorua-hisuian', 'pokemondbSlug should expand Hisuian prefix');
eq(pokemondbSlug('P-Wooper', 'P-Wooper'), 'wooper-paldean', 'pokemondbSlug should expand Paldean prefix');

// Regional + parenthetical reorder
eq(pokemondbSlug('P-Tauros (Aqua)', 'P-Tauros (Aqua)'), 'tauros-paldean-aqua', 'pokemondbSlug should reorder regional + form');

// Regional + punctuation
eq(pokemondbSlug("G-Farfetch'd", "G-Farfetch'd"), 'farfetchd-galarian', 'pokemondbSlug should strip apostrophe in regional name');
eq(pokemondbSlug('G-Mr_ Mime', 'G-Mr. Mime'), 'mr-mime-galarian', 'pokemondbSlug should drop period in regional name (dn precedence)');

// Basculin: synthetic quirk-trigger path + real-data over-match guard
eq(pokemondbSlug('Basculin (Red)', 'Basculin (Red)'), 'basculin-red-striped', 'pokemondbSlug should apply basculin striped quirk for bare colour');
eq(pokemondbSlug('Basculin (Red Stripe)', 'Basculin (Red Stripe)'), 'basculin-red-stripe', 'pokemondbSlug should NOT over-match real-data Red Stripe (quirk dead)');

// Flabébé: real flower quirk + over-match guard
eq(pokemondbSlug('Flabébé (Red Flower)', 'Flabébé (Red Flower)'), 'flabebe-red', 'pokemondbSlug should drop -flower for Flabebe');
eq(pokemondbSlug('Flabébé', 'Flabébé'), 'flabebe', 'pokemondbSlug should not over-match bare Flabebe');

// Oricorio: real-data apostrophe path (quirk dead) + synthetic Pa-u path (quirk live)
eq(pokemondbSlug("Oricorio (Pa'u)", "Oricorio (Pa'u)"), 'oricorio-pau', 'pokemondbSlug should produce oricorio-pau from apostrophe form');
eq(pokemondbSlug('Oricorio (Pa-u)', 'Oricorio (Pa-u)'), 'oricorio-pau', 'pokemondbSlug should apply oricorio pa-u quirk for hyphen form');

// Shellos sea-name quirks + over-match guard
eq(pokemondbSlug('Shellos (Pink)', 'Shellos (Pink)'), 'shellos-west', 'pokemondbSlug should map Shellos Pink to west');
eq(pokemondbSlug('Shellos (Blue)', 'Shellos (Blue)'), 'shellos-east', 'pokemondbSlug should map Shellos Blue to east');
eq(pokemondbSlug('Shellos', 'Shellos'), 'shellos', 'pokemondbSlug should not over-match bare Shellos');

// Plain punctuation / non-regional parenthetical
eq(pokemondbSlug('Mr. Mime', 'Mr. Mime'), 'mr-mime', 'pokemondbSlug should slug Mr. Mime');
eq(pokemondbSlug("Farfetch'd", "Farfetch'd"), 'farfetchd', 'pokemondbSlug should slug Farfetchd');
eq(pokemondbSlug('Vivillon (Garden)', 'Vivillon (Garden)'), 'vivillon-garden', 'pokemondbSlug should flatten non-regional parenthetical');

// Female suffix: append / non-append / no double-append
eq(pokemondbSlug('Pikachu', 'Pikachu', 'f'), 'pikachu-female', 'pokemondbSlug should append -female for f');
eq(pokemondbSlug('Pikachu', 'Pikachu', ''), 'pikachu', 'pokemondbSlug should not append for empty gender');
eq(pokemondbSlug('Pikachu', 'Pikachu', 'm'), 'pikachu', 'pokemondbSlug should not append for m');
eq(pokemondbSlug('Frillish (Female)', 'Frillish (Female)', 'f'), 'frillish-female', 'pokemondbSlug should not double-append female');

// dn precedence + fallback to name
eq(pokemondbSlug('A-Raichu', 'Raichu (Alolan)'), 'raichu-alolan', 'pokemondbSlug should prefer dn over name');
eq(pokemondbSlug('Pikachu', ''), 'pikachu', 'pokemondbSlug should fall back to name when dn empty');

// Regional regex no-over-match
eq(pokemondbSlug('Ho-Oh', 'Ho-Oh'), 'ho-oh', 'pokemondbSlug should not treat Ho-Oh as regional');
eq(pokemondbSlug('Hitmonlee', 'Hitmonlee'), 'hitmonlee', 'pokemondbSlug should leave plain names alone');

// Empty / blank / undefined / undefined-with-female early return
eq(pokemondbSlug('', ''), '', 'pokemondbSlug should return empty for empty input');
eq(pokemondbSlug('   ', '   '), '', 'pokemondbSlug should return empty for blank input');
eq(pokemondbSlug(undefined, undefined), '', 'pokemondbSlug should return empty for undefined input');
eq(pokemondbSlug(undefined, undefined, 'f'), '', 'pokemondbSlug should early-return before female append on empty input');

// --- textSafety ---
const { safeFilePart, escHtml, escAttr } = utils.textSafety;
eq(safeFilePart("Mazer's Trades List 2026!"), 'mazer-s-trades-list-2026', 'safeFilePart should slug names');
eq(safeFilePart(''), 'list', 'safeFilePart should fallback for empty input');
eq(
  escHtml(`<div class="x">Tom & 'Jerry'</div>`),
  '&lt;div class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/div&gt;',
  'escHtml should escape HTML-sensitive characters'
);
eq(escAttr('"onmouseover=1"'), '&quot;onmouseover=1&quot;', 'escAttr should escape attribute text');

// --- stringPanels ---
const { strLevelsHtml } = ui.stringPanels;
const priorityPanel = strLevelsHtml({
  H:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&1,4',
  M:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&7',
  L:'!4*&!traded&!shiny&CP-2500&!shadow&!purified&!background&10'
});
eq((priorityPanel.match(/class="str-level"/g)||[]).length, 7, 'strLevelsHtml should render three priority panels and four useful combinations');
for (const priority of ['H','M','L']) assert(priorityPanel.includes(`class="badge ${priority}"`), `strLevelsHtml should render the ${priority} priority panel`);
eq((priorityPanel.match(/class="share-search-disclosure"/g)||[]).length, 7, 'every rendered search should use collapsed progressive disclosure');
eq((priorityPanel.match(/href="#ui-icon-copy"/g)||[]).length, 7, 'every copy action should use the shared SVG copy icon');
assert(!priorityPanel.includes('📋 Copy'), 'retired emoji copy controls should remain absent');
assert(priorityPanel.includes('Combined options <span class="combo-meta">4 available</span>'), 'combined search count should remain explicit');
for (const label of ['High + Medium','High + Low','Medium + Low','All priorities']) assert(priorityPanel.includes(label), `combined search should include ${label}`);
const specialPanel = strLevelsHtml({H:'base&1',LUCKY:'lucky&25',XXL:'xxl&143',XXS:'xxs&19'});
for (const className of ['lucky-str','xxl-str','xxs-str']) assert(specialPanel.includes(`class="str-level ${className}"`), `special searches should render ${className}`);
eq((specialPanel.match(/class="share-search-disclosure"/g)||[]).length, 4, 'priority and special searches should all remain collapsed by default');
const hmPanel = strLevelsHtml({H:'base&1,4',M:'base&4,7'});
assert(hmPanel.includes('Combined options <span class="combo-meta">2 available</span>'), 'H+M should retain two distinct combined options');
assert(!strLevelsHtml({H:'base&1'}).includes('combo-wrap'), 'single-priority searches should omit combined options');
const lowOnlyPanel = strLevelsHtml({L:'base&10'});
assert(lowOnlyPanel.includes('class="badge L"')&&!lowOnlyPanel.includes('class="badge H"')&&!lowOnlyPanel.includes('class="badge M"'), 'partial priority keys should render only populated panels');
const escSnapshot = strLevelsHtml({ H: 'a&b"c<d' });
assert(escSnapshot.includes('data-copy="a&amp;b&quot;c&lt;d"'), 'strLevelsHtml data-copy should use escAttr-escaped value');
assert(escSnapshot.includes('<div class="strbox">a&amp;b&quot;c&lt;d</div>'), 'strLevelsHtml disclosure text should use escHtml-escaped value');

// --- emptyState ---
const { emptyHtml, EMPTY_SVGS } = ui.emptyState;
assert(EMPTY_SVGS && typeof EMPTY_SVGS === 'object', 'EMPTY_SVGS map should exist');
// known SVG icons render the inline <svg> markup
eq(emptyHtml('No matches','Clear the filter.','🔍'), "<div class=\"empty empty-state\"><svg class=\"empty-svg state-svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"28\" cy=\"28\" r=\"14\"/><line x1=\"38\" y1=\"38\" x2=\"50\" y2=\"50\"/></svg><div class=\"empty-t empty-state-title\">No matches</div><div class=\"empty-s empty-state-detail\">Clear the filter.</div></div>", 'emptyHtml search icon');
eq(emptyHtml('No search strings yet','','📋'), "<div class=\"empty empty-state\"><svg class=\"empty-svg state-svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"14\" y=\"8\" width=\"36\" height=\"48\" rx=\"3\"/><line x1=\"20\" y1=\"20\" x2=\"44\" y2=\"20\"/><line x1=\"20\" y1=\"28\" x2=\"44\" y2=\"28\"/><line x1=\"20\" y1=\"36\" x2=\"36\" y2=\"36\"/></svg><div class=\"empty-t empty-state-title\">No search strings yet</div></div>", 'emptyHtml clipboard icon, no subtitle');
eq(emptyHtml('Settings','Adjust below','⚙️'), "<div class=\"empty empty-state\"><svg class=\"empty-svg state-svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"32\" cy=\"32\" r=\"6\"/><path d=\"M32 12v6M32 46v6M52 32h-6M18 32h-6M46 18l-4 4M22 42l-4 4M46 46l-4-4M22 22l-4-4\"/></svg><div class=\"empty-t empty-state-title\">Settings</div><div class=\"empty-s empty-state-detail\">Adjust below</div></div>", 'emptyHtml gear icon');
// unknown icon falls back to <div class="empty-i">icon</div>
eq(emptyHtml('Nothing','sub','🎒'), "<div class=\"empty empty-state\"><div class=\"empty-i\" aria-hidden=\"true\">🎒</div><div class=\"empty-t empty-state-title\">Nothing</div><div class=\"empty-s empty-state-detail\">sub</div></div>", 'emptyHtml unknown icon fallback');
// subtitle present vs omitted
eq(emptyHtml('Title','A subtitle','🔍'), "<div class=\"empty empty-state\"><svg class=\"empty-svg state-svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"28\" cy=\"28\" r=\"14\"/><line x1=\"38\" y1=\"38\" x2=\"50\" y2=\"50\"/></svg><div class=\"empty-t empty-state-title\">Title</div><div class=\"empty-s empty-state-detail\">A subtitle</div></div>", 'emptyHtml with subtitle');
eq(emptyHtml('Title','','🔍'), "<div class=\"empty empty-state\"><svg class=\"empty-svg state-svg\" viewBox=\"0 0 64 64\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"28\" cy=\"28\" r=\"14\"/><line x1=\"38\" y1=\"38\" x2=\"50\" y2=\"50\"/></svg><div class=\"empty-t empty-state-title\">Title</div></div>", 'emptyHtml without subtitle');
// raw/unescaped behavior for title, subtitle, and fallback icon (no escaping is applied)
eq(emptyHtml('<b>a&b</b>','<i>s"x</i>','🌟'), "<div class=\"empty empty-state\"><div class=\"empty-i\" aria-hidden=\"true\">🌟</div><div class=\"empty-t empty-state-title\"><b>a&b</b></div><div class=\"empty-s empty-state-detail\"><i>s\"x</i></div></div>", 'emptyHtml leaves t/s/icon raw and unescaped');
assert(emptyHtml('<b>a&b</b>','','🌟').includes('<b>a&b</b>'), 'title is not HTML-escaped');
assert(emptyHtml('x','','🌟').includes('<div class="empty-i" aria-hidden="true">🌟</div>'), 'unknown icon rendered raw in fallback');

console.log('Domain helper checks passed.');
