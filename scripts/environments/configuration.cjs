'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const BEGIN='/* POGO_ENVIRONMENT_CONFIG_BEGIN */',END='/* POGO_ENVIRONMENT_CONFIG_END */';
const root=path.resolve(__dirname,'../..');
const identities=Object.freeze({
  production:{projectId:'trade-list-a4297',projectNumber:'1053781218847',databaseId:'trade-list-a4297-default-rtdb',appId:'1:1053781218847:web:378b312470943152d9a72a',apiKey:'AIzaSyCazZNLj9_lEb1vUNUlrMe9hodqY_l34VU',appCheckSiteKey:'6Lc6-X8tAAAAAI-MY4WdeI8RV-njpbiFX5mFjDbz'},
  staging:{projectId:'trainer-hub-staging-37ib4wct',projectNumber:'391359988648',databaseId:'trainer-hub-staging-37ib4wct-share124',appId:'1:391359988648:web:d5455df9a12624d3f8d39d',apiKey:'AIzaSyB4bNx1smbZOTsldMG8WMYb1mdEOSEzi1U',appCheckSiteKey:'6LeC-n0tAAAAAFRXDuCnTVeMSiHZNcByWKzgAzvR'}
});
function validateConfiguration(value,profile){
  const identity=identities[profile];
  assert.ok(identity,'An explicit production or staging profile is required');
  assert.deepEqual(Object.keys(value||{}).sort(),['appCheckSiteKey','firebase','profile','schemaVersion']);
  assert.equal(value.schemaVersion,1);assert.equal(value.profile,profile,'Configuration profile mismatch');
  const f=value.firebase;
  assert.deepEqual(Object.keys(f||{}).sort(),['apiKey','appId','authDomain','databaseURL','measurementId','messagingSenderId','projectId','storageBucket']);
  assert.equal(f.projectId,identity.projectId);assert.equal(f.messagingSenderId,identity.projectNumber);
  assert.equal(f.appId,identity.appId);assert.equal(f.authDomain,`${identity.projectId}.firebaseapp.com`);
  assert.equal(f.databaseURL,`https://${identity.databaseId}.firebaseio.com`);
  assert.equal(f.storageBucket,`${identity.projectId}.firebasestorage.app`);
  assert.equal(value.appCheckSiteKey,identity.appCheckSiteKey);
  assert.equal(f.apiKey,identity.apiKey);assert.equal(typeof f.measurementId,'string');
  if(profile==='staging')assert.equal(f.measurementId,'');
  else assert.equal(f.measurementId,'G-0ZFL5NDQFP');
  return value;
}
function configuration(profile,source=root){
  assert.ok(Object.hasOwn(identities,profile),'An explicit production or staging profile is required');
  const value=JSON.parse(fs.readFileSync(path.join(source,`release/environments/${profile}.json`),'utf8'));
  validateConfiguration(value,profile);
  // Public web configuration is still exact reviewed input, never a fallback.
  const trusted=JSON.parse(fs.readFileSync(path.join(root,`release/environments/${profile}.json`),'utf8'));
  assert.deepEqual(value,trusted,'Configuration differs from reviewed profile');
  return value;
}
function configBlock(html){
  assert.equal(html.split(BEGIN).length,2,'Expected one environment configuration boundary');
  assert.equal(html.split(END).length,2,'Expected one environment configuration boundary');
  const start=html.indexOf(BEGIN),end=html.indexOf(END)+END.length;
  assert.ok(end>start);
  const body=html.slice(start+BEGIN.length,end-END.length).trim();
  assert.ok(body.startsWith('const pogoEnvironment=')&&body.endsWith(';'),'Invalid configuration boundary');
  return{start,end,value:JSON.parse(body.slice('const pogoEnvironment='.length,-1))};
}
function replaceConfiguration(html,value){
  const {start,end}=configBlock(html);
  return html.slice(0,start)+`${BEGIN}\nconst pogoEnvironment=${JSON.stringify(value,null,2)};\n${END}`+html.slice(end);
}
function configurationDigest(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
module.exports={BEGIN,END,identities,configuration,validateConfiguration,configBlock,replaceConfiguration,configurationDigest};
