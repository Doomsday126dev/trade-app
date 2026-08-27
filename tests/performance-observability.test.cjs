'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const schema=require('../scripts/performance/privacy-safe-observability.cjs');

const root=path.resolve(__dirname,'..');
const documentation=fs.readFileSync(path.join(root,'docs/PERFORMANCE-OBSERVABILITY.md'),'utf8');
const performanceWorkflow=fs.readFileSync(path.join(root,'.github/workflows/frontend-performance.yml'),'utf8');
const packageManifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
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

test('performance CI uses immutable reviewed action revisions',()=>{
  assert.match(performanceWorkflow,/actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/u);
  assert.match(performanceWorkflow,/actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u);
  assert.doesNotMatch(performanceWorkflow,/uses:\s+actions\/(?:checkout|setup-node)@v\d/u);
});

test('constrained browser profiles run serially to avoid synthetic CPU contention',()=>{
  assert.match(packageManifest.scripts['test:performance:browser'],/--workers=1(?:\s|$)/u);
});
