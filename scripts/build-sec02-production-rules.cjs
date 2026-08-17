#!/usr/bin/env node
'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const BASELINE=path.join(ROOT,'tests/firebase/database.rules.narrow-read.json');
const REQUEST_CANDIDATE=path.join(ROOT,'tests/firebase/database.rules.request-access-candidate.json');
const OUTPUT=path.join(ROOT,'tests/firebase/database.rules.sec02-production.json');

function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function serialize(value){return `${JSON.stringify(value,null,2)}\n`;}

function build(){
  const baseline=readJson(BASELINE);
  const requestCandidate=readJson(REQUEST_CANDIDATE);
  assert.ok(baseline.rules?.requests,'authoritative baseline must contain /requests');
  assert.ok(requestCandidate.rules?.requests,'SEC-02 candidate must contain /requests');

  const production=structuredClone(baseline);
  production.rules.requests=structuredClone(requestCandidate.rules.requests);

  const baselineOutside=structuredClone(baseline);
  const productionOutside=structuredClone(production);
  delete baselineOutside.rules.requests;
  delete productionOutside.rules.requests;
  assert.deepEqual(productionOutside,baselineOutside,'SEC-02 assembly changed Rules outside /requests');
  assert.deepEqual(Object.keys(production.rules),Object.keys(baseline.rules),'SEC-02 assembly changed root Rules');
  return serialize(production);
}

if(require.main===module){
  const expected=build();
  if(process.argv.includes('--check')){
    assert.equal(fs.readFileSync(OUTPUT,'utf8'),expected,'production Rules artifact is stale; run build:sec02-production-rules');
  }else{
    fs.writeFileSync(OUTPUT,expected);
  }
}

module.exports={BASELINE,REQUEST_CANDIDATE,OUTPUT,build};
