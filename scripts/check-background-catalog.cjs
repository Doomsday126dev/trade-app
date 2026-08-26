#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {mappingReviewCandidates,validateCatalog}=require('./backgrounds/background-catalog-lib.cjs');
const ROOT=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'data','backgrounds.json'),'utf8'));
const snapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'data','background-upstream-snapshot.json'),'utf8'));
const result=validateCatalog(catalog);
const errors=[...result.errors];
if(snapshot?.schemaVersion!==1)errors.push('upstream snapshot schemaVersion must be 1');
if(!/^[a-f0-9]{40}$/.test(snapshot?.sourceCommit||''))errors.push('upstream snapshot must pin a full commit SHA');
if(!Array.isArray(snapshot?.files)||snapshot.files.length<100)errors.push('upstream snapshot is unexpectedly small');
if(JSON.stringify([...snapshot.files].sort())!==JSON.stringify(snapshot.files))errors.push('upstream snapshot files are not sorted');
if(new Set(snapshot.files).size!==snapshot.files.length)errors.push('upstream snapshot contains duplicates');
if(errors.length){errors.forEach(error=>console.error(error));process.exit(1);}
const mappingReview=mappingReviewCandidates(catalog);
console.log(JSON.stringify({ok:true,total:result.total,released:result.released,candidates:result.candidates,catalogDigest:result.digest,upstreamCommit:snapshot.sourceCommit,upstreamFiles:snapshot.files.length,mappingReview},null,2));
