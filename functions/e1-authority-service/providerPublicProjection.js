'use strict';

const LIST_TYPES = Object.freeze(['wishlist', 'dynamax', 'gmax', 'costumes']);
const TOP_LEVEL_FIELDS = Object.freeze([
  'lists', 'profile', 'publishedAt', 'publishedListTypes', 'schemaVersion', 'shareVersion', 'trainerName', 'updatedAt'
]);
const REQUIRED_TOP_LEVEL_FIELDS = Object.freeze(TOP_LEVEL_FIELDS.filter((field) => field !== 'lists'));
const PROFILE_FIELDS = Object.freeze(['avatarPokemon', 'bio', 'discord', 'friendCode', 'lastUpdated']);
const ENTRY_FIELDS = Object.freeze(['backgroundId', 'lucky', 'mod', 'p', 'shiny', 'xxl', 'xxs']);
const PRIORITIES = new Set(['H', 'M', 'L']);
const BACKGROUND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_PROJECTION_BYTES = 512 * 1024;
const MAX_TOTAL_ENTRIES = 2000;

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function optionalFields(value, fields) {
  return plainObject(value) && Object.keys(value).every((key) => fields.includes(key));
}

function projectionFields(value) {
  return optionalFields(value, TOP_LEVEL_FIELDS) && REQUIRED_TOP_LEVEL_FIELDS.every((field) => Object.hasOwn(value, field));
}

function safeString(value, max, { empty = true } = {}) {
  return typeof value === 'string' && !CONTROL.test(value) && value.length <= max && (empty || value.length > 0);
}

function safeDynamicKey(value, max) {
  return safeString(value, max, { empty: false }) && !DANGEROUS_KEYS.has(value);
}

function safeTimestamp(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
}

function validEntry(value) {
  if (typeof value === 'string') return value.length > 0 && value.length <= 512 && !CONTROL.test(value);
  if (!optionalFields(value, ENTRY_FIELDS) || !PRIORITIES.has(value.p)) return false;
  if (Object.hasOwn(value, 'mod') && !safeString(value.mod, 200)) return false;
  for (const field of ['lucky', 'shiny', 'xxl', 'xxs']) {
    if (Object.hasOwn(value, field) && typeof value[field] !== 'boolean') return false;
  }
  return !Object.hasOwn(value, 'backgroundId') || value.backgroundId === '' ||
    safeString(value.backgroundId, 120, { empty: false }) && BACKGROUND_ID.test(value.backgroundId);
}

function sanitizeProviderPublicProjection(value, { trainerName } = {}) {
  const expectedTrainerName = String(trainerName || '').trim();
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(value)); } catch { return null; }
  if (bytes > MAX_PROJECTION_BYTES || !projectionFields(value) || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.shareVersion) || value.shareVersion < 1 ||
      !safeString(value.trainerName, 64, { empty: false }) ||
      expectedTrainerName && value.trainerName !== expectedTrainerName ||
      !safeTimestamp(value.publishedAt, { positive: true }) || !safeTimestamp(value.updatedAt, { positive: true }) ||
      value.updatedAt < value.publishedAt || !exactFields(value.publishedListTypes, LIST_TYPES) ||
      LIST_TYPES.some((type) => value.publishedListTypes[type] !== true) ||
      !optionalFields(value.lists || {}, LIST_TYPES) || !exactFields(value.profile, PROFILE_FIELDS)) return null;

  const profile = value.profile;
  if (!safeString(profile.friendCode, 32) || !safeString(profile.bio, 120) || !safeString(profile.discord, 40) ||
      !safeString(profile.avatarPokemon, 80) || !safeTimestamp(profile.lastUpdated)) return null;

  let entryCount = 0;
  const lists = Object.create(null);
  for (const type of LIST_TYPES) {
    const source = value.lists?.[type] || {};
    if (!plainObject(source)) return null;
    const entries = Object.entries(source);
    entryCount += entries.length;
    if (entryCount > MAX_TOTAL_ENTRIES) return null;
    lists[type] = Object.create(null);
    for (const [name, entry] of entries) {
      if (!safeDynamicKey(name, 200) || !validEntry(entry)) return null;
      lists[type][name] = plainObject(entry) ? { ...entry } : entry;
    }
    Object.freeze(lists[type]);
  }

  return Object.freeze({
    version: 1,
    username: value.trainerName,
    profile: Object.freeze({ ...profile }),
    lists: Object.freeze(lists),
    publishedListTypes: Object.freeze([...LIST_TYPES]),
    updatedAt: value.updatedAt
  });
}

module.exports = Object.freeze({
  ENTRY_FIELDS,
  LIST_TYPES,
  MAX_PROJECTION_BYTES,
  MAX_TOTAL_ENTRIES,
  PROFILE_FIELDS,
  REQUIRED_TOP_LEVEL_FIELDS,
  TOP_LEVEL_FIELDS,
  sanitizeProviderPublicProjection
});
