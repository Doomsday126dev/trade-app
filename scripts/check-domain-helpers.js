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
  'js/domain/username.js',
  'js/domain/priorityValues.js',
  'js/domain/scheduleDates.js',
  'js/domain/pokemonSearchTerms.js',
  'js/domain/pokemonEntryRules.js',
  'js/domain/searchStrings.js',
  'js/domain/scheduleEventRules.js',
  'js/domain/scheduleTradeRules.js',
  'js/domain/pokemonKeys.js',
  'js/domain/fuzzyText.js',
  'js/domain/relativeTime.js',
  'js/utils/textSafety.js'
].forEach(loadBrowserScript);

const domain = context.window.PogoDomain;
const utils = context.window.PogoUtils;

assert(domain, 'window.PogoDomain namespace should exist');
assert(utils, 'window.PogoUtils namespace should exist');
assert(domain.priorities, 'priorities namespace should exist');
assert(domain.username, 'username namespace should exist');
assert(domain.priorityValues, 'priorityValues namespace should exist');
assert(domain.scheduleDates, 'scheduleDates namespace should exist');
assert(domain.pokemonSearchTerms, 'pokemonSearchTerms namespace should exist');
assert(domain.pokemonEntryRules, 'pokemonEntryRules namespace should exist');
assert(domain.searchStrings, 'searchStrings namespace should exist');
assert(domain.scheduleEventRules, 'scheduleEventRules namespace should exist');
assert(domain.scheduleTradeRules, 'scheduleTradeRules namespace should exist');
assert(domain.pokemonKeys, 'pokemonKeys namespace should exist');
assert(domain.fuzzyText, 'fuzzyText namespace should exist');
assert(domain.relativeTime, 'relativeTime namespace should exist');
assert(utils.textSafety, 'textSafety namespace should exist');

const { priLabel, priName, listLabel } = domain.priorities;
eq(priLabel('H'), 'High', 'priLabel should resolve H');
eq(priName('M'), 'M - Medium', 'priName should resolve M');
eq(listLabel('wishlist'), 'Trades', 'listLabel should resolve wishlist');

const { alphaCompare } = domain.username;
assert(alphaCompare('a2', 'a10') < 0, 'alphaCompare should sort natural numeric suffixes');
eq(alphaCompare('Mazer', 'mazer'), 0, 'alphaCompare should be case-insensitive');

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

const {
  uniqueEntries,
  costumeDedupeKey,
  isTradeableForWishlist
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
deepEq(stringParts(PREFILTER + '26, alola&27'), ['26', 'alola&27'], 'stringParts should trim and split terms');
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

const { safeFilePart, escHtml, escAttr } = utils.textSafety;
eq(safeFilePart("Mazer's Trades List 2026!"), 'mazer-s-trades-list-2026', 'safeFilePart should slug names');
eq(safeFilePart(''), 'list', 'safeFilePart should fallback for empty input');
eq(
  escHtml(`<div class="x">Tom & 'Jerry'</div>`),
  '&lt;div class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/div&gt;',
  'escHtml should escape HTML-sensitive characters'
);
eq(escAttr('"onmouseover=1"'), '&quot;onmouseover=1&quot;', 'escAttr should escape attribute text');

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

console.log('Domain helper checks passed.');
