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
  'js/domain/searchStrings.js',
  'js/domain/scheduleEventRules.js',
  'js/domain/scheduleTradeRules.js',
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
assert(domain.searchStrings, 'searchStrings namespace should exist');
assert(domain.scheduleEventRules, 'scheduleEventRules namespace should exist');
assert(domain.scheduleTradeRules, 'scheduleTradeRules namespace should exist');
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
  castformTypeFromSearchFilters
} = domain.pokemonSearchTerms;
eq(regionalFormPrefix('A-Raichu'), 'A', 'regionalFormPrefix should find A prefix');
eq(regionalFormTerm('G-Corsola'), 'galar', 'regionalFormTerm should resolve G prefix');
eq(regionTermFromDex(25), 'kanto', 'regionTermFromDex should resolve Kanto');
eq(regionTermFromDex(900), 'hisui', 'regionTermFromDex should resolve Hisui');
eq(dexSearchTerm({ name: 'A-Raichu', no: 26 }, {}), 'alola&26', 'dexSearchTerm should include Alola qualifier');
eq(dexSearchTerm({ name: 'P-Tauros (Aqua)', no: 128 }, {}), 'paldea&128', 'dexSearchTerm should include Paldea qualifier');
eq(castformTypeFilter({ name: 'Castform (Snowy)', no: 351 }, ''), 'ice', 'castformTypeFilter should resolve Snowy');
eq(castformTypeFilter({ name: 'Castform', no: 351 }, 'rainy'), 'water', 'castformTypeFilter should resolve rainy modifier');
deepEq(modSearchFilters('female xxs'), ['female', 'xxs'], 'modSearchFilters should parse female and xxs');
deepEq(modSearchFilters('shiny male xxl'), ['shiny', 'male', 'xxl'], 'modSearchFilters should parse shiny, male, and xxl');
eq(modFromSearchFilters(['female', 'xxs']), 'f', 'modFromSearchFilters should prefer female');
eq(modFromSearchFilters(['male', 'xxl']), 'm', 'modFromSearchFilters should prefer male');
eq(castformTypeFromSearchFilters(['water', 'female']), 'water', 'castformTypeFromSearchFilters should find water');

const {
  PREFILTER,
  POGO_STR_LIMIT,
  dexStringFromNumbers,
  stringFromSearchItems,
  stringParts,
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
assert(strLenInfo('x'.repeat(POGO_STR_LIMIT + 1)).cls !== '', 'strLenInfo should classify over-limit strings');

const {
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
eq(scheduledTradeQuantity({ type: 'special', regularCount: 25 }), 1, 'scheduledTradeQuantity should count non-regular trades as 1');
const tradeRows = [
  { type: 'regular', status: 'scheduled', regularCount: 5 },
  { type: 'regular', status: 'completed', regularCount: 3 },
  { type: 'special', status: 'completed' },
  { type: 'remote', status: 'scheduled' },
  { status: 'cancelled', regularCount: 2 }
];
const summary = summarizeScheduledTrades(tradeRows);
eq(summary.special, 1, 'summarizeScheduledTrades should count special trades');
eq(summary.regular, 10, 'summarizeScheduledTrades should count regular quantities, including current cancelled-row behavior');
eq(summary.remote, 1, 'summarizeScheduledTrades should count remote trades');
eq(summary.total, 12, 'summarizeScheduledTrades should total trade quantities');
eq(summary.scheduled, 3, 'summarizeScheduledTrades should count scheduled rows, not regular quantities');
eq(summary.completed, 2, 'summarizeScheduledTrades should count completed rows, not regular quantities');
deepEq(
  summary.byStatus,
  {
    special: { scheduled: 0, completed: 1 },
    regular: { scheduled: 7, completed: 3 },
    remote: { scheduled: 1, completed: 0 }
  },
  'summarizeScheduledTrades should preserve current byStatus quantity behavior'
);
eq(summary.trades, tradeRows, 'summarizeScheduledTrades should return the original trades array reference');

const { safeFilePart, escHtml, escAttr } = utils.textSafety;
eq(safeFilePart("Mazer's Trades List 2026!"), 'mazer-s-trades-list-2026', 'safeFilePart should slug names');
eq(safeFilePart(''), 'list', 'safeFilePart should fallback for empty input');
eq(
  escHtml(`<div class="x">Tom & 'Jerry'</div>`),
  '&lt;div class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/div&gt;',
  'escHtml should escape HTML-sensitive characters'
);
eq(escAttr('"onmouseover=1"'), '&quot;onmouseover=1&quot;', 'escAttr should escape attribute text');

console.log('Domain helper checks passed.');
