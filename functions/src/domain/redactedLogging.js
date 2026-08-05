'use strict';

const ALLOWED = new Set(['operation', 'status', 'errorClass', 'mode', 'correlationHash', 'durationMs', 'appCheckPresent', 'replay']);

function createRedactedLogger(sink = console) {
  return Object.freeze({
    write(event) {
      const clean = {};
      for (const [key, value] of Object.entries(event || {})) if (ALLOWED.has(key)) clean[key] = value;
      sink.info(JSON.stringify({ schemaVersion: 1, ...clean }));
    }
  });
}

module.exports = { createRedactedLogger, LOG_FIELDS: Object.freeze([...ALLOWED]) };
