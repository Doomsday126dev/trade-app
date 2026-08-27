'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const schema=require('../scripts/performance/privacy-safe-observability.cjs');

const root=path.resolve(__dirname,'..');
const documentation=fs.readFileSync(path.join(root,'docs/PERFORMANCE-OBSERVABILITY.md'),'utf8');
const productionSources=[
  fs.readFileSync(path.join(root,'index.html'),'utf8'),
  fs.readFileSync(path.join(root,'js/app/application.js'),'utf8'),
  fs.readFileSync(path.join(root,'sw.js'),'utf8')
].join('\n');

function validEvent(){
  return{
    schemaVersion:1,
    event:'my-list-filter',
    release:'2026-08-27.71',
    viewportBucket:'mobile-medium',
    durationBucket:'50-99',
    longTaskCountBucket:'0',
    listSizeBucket:'50-149'
  };
}

test('performance event design accepts only coarse non-identifying buckets',()=>{
  assert.equal(schema.validateLocalPerformanceEvent(validEvent()),true);
  assert.deepEqual(schema.ALLOWED_FIELDS,Object.keys(validEvent()));
  for(const field of ['uid','trainerName','pokemon','query','timestamp','url','userAgent','listContent']){
    assert.equal(schema.validateLocalPerformanceEvent({...validEvent(),[field]:'private'}),false,field);
  }
  assert.equal(schema.validateLocalPerformanceEvent({...validEvent(),durationBucket:'73.42'}),false);
  assert.equal(schema.validateLocalPerformanceEvent({...validEvent(),listSizeBucket:'137'}),false);
});

test('observability remains design-only with no production transport or persistence',()=>{
  assert.match(documentation,/design-only, local tooling/u);
  assert.match(documentation,/no event is persisted/u);
  assert.match(documentation,/no transport or backend exists/u);
  assert.doesNotMatch(productionSources,/privacy-safe-observability|PERFORMANCE-OBSERVABILITY/u);
});
