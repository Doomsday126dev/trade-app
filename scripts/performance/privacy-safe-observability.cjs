'use strict';

const SCHEMA_VERSION=1;
const ALLOWED_FIELDS=Object.freeze([
  'schemaVersion',
  'event',
  'release',
  'viewportBucket',
  'durationBucket',
  'longTaskCountBucket',
  'listSizeBucket'
]);
const EVENT_VALUES=Object.freeze(['startup','feature-activation','my-list-filter','my-list-render']);
const VIEWPORT_VALUES=Object.freeze(['desktop','mobile-large','mobile-medium','mobile-compact','other']);
const DURATION_VALUES=Object.freeze(['lt-50','50-99','100-199','200-499','500-999','1000-2999','gte-3000']);
const LONG_TASK_VALUES=Object.freeze(['0','1','2-4','5-plus']);
const LIST_SIZE_VALUES=Object.freeze(['none','1-49','50-149','150-499','500-999','1000-plus']);

function exactKeys(value){return Object.keys(value).sort().join(',')===ALLOWED_FIELDS.slice().sort().join(',');}
function validateLocalPerformanceEvent(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!exactKeys(value))return false;
  return value.schemaVersion===SCHEMA_VERSION
    &&typeof value.release==='string'&&/^\d{4}-\d{2}-\d{2}\.\d+$/.test(value.release)
    &&EVENT_VALUES.includes(value.event)
    &&VIEWPORT_VALUES.includes(value.viewportBucket)
    &&DURATION_VALUES.includes(value.durationBucket)
    &&LONG_TASK_VALUES.includes(value.longTaskCountBucket)
    &&LIST_SIZE_VALUES.includes(value.listSizeBucket);
}

module.exports=Object.freeze({
  SCHEMA_VERSION,
  ALLOWED_FIELDS,
  EVENT_VALUES,
  VIEWPORT_VALUES,
  DURATION_VALUES,
  LONG_TASK_VALUES,
  LIST_SIZE_VALUES,
  validateLocalPerformanceEvent
});
