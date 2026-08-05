const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const registrySource=readFileSync(path.join(ROOT,'js/data/firebaseReadRegistry.js'),'utf8');
const window={};
vm.runInNewContext(registrySource,{window});
const registry=window.PogoData.firebaseReadRegistry.READ_SURFACES;
const contract=JSON.parse(readFileSync(path.join(ROOT,'tests/firebase/narrow-read-surface-map.json'),'utf8'));
const candidate=JSON.parse(readFileSync(path.join(ROOT,'tests/firebase/database.rules.narrow-read.json'),'utf8')).rules;
const hardened=JSON.parse(readFileSync(path.join(ROOT,'tests/firebase/database.rules.hardened.json'),'utf8')).rules;
const emulatorSource=readFileSync(path.join(ROOT,'tests/firebase/narrow-read-rules.test.cjs'),'utf8');

function atRulePath(rulePath){
  return String(rulePath).split('/').filter(Boolean).reduce((node,key)=>node?.[key],candidate);
}
function stripReads(value){
  if(Array.isArray(value))return value.map(stripReads);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='.read').map(([key,child])=>[key,stripReads(child)]));
}
function collectBroadReads(node,current=[],out=[]){
  if(!node||typeof node!=='object')return out;
  if(current.length&&node['.read']!==undefined&&node['.read']!==false&&!current.some(part=>part.startsWith('$')))out.push(current.join('/'));
  for(const [key,child] of Object.entries(node))if(!key.startsWith('.'))collectBroadReads(child,[...current,key],out);
  return out;
}

assert.equal(candidate['.read'],false,'Candidate root read must be denied');
assert.equal(candidate['.write'],undefined,'Candidate must preserve child-scoped writes without introducing a root write');
assert.deepEqual(stripReads(candidate),stripReads(hardened),'Narrow-read candidate may not change production write semantics');

const registryIds=Array.from(registry,surface=>String(surface.id)).sort();
const mappedIds=contract.surfaces.map(surface=>surface.registryId).sort();
assert.deepEqual(mappedIds,registryIds,'Every registered Firebase read surface must have exactly one narrow-rule mapping');
assert.equal(new Set(mappedIds).size,mappedIds.length,'Narrow-rule mapping IDs must be unique');

const validAccess=new Set(['anonymous','owner','owner_or_admin','admin','anonymous_or_owner_or_admin','denied']);
const validStates=new Set(['production_active','production_admin_on_demand','disabled_future','disabled_legacy_setup']);
for(const surface of contract.surfaces){
  for(const field of ['registryId','workflow','path','accessClass','rulePaths','emulatorTest','state'])assert.ok(Object.hasOwn(surface,field),`${surface.registryId||'unknown'} missing ${field}`);
  assert.ok(validAccess.has(surface.accessClass),`${surface.registryId} has invalid access class`);
  assert.ok(validStates.has(surface.state),`${surface.registryId} has invalid state`);
  assert.ok(emulatorSource.includes(`test('${surface.emulatorTest}'`),`${surface.registryId} references a missing emulator test`);
  if(surface.accessClass==='denied')assert.equal(surface.rulePaths.length,0,`${surface.registryId} must not map a disabled read rule`);
  else for(const rulePath of surface.rulePaths)assert.notEqual(atRulePath(rulePath)?.['.read'],undefined,`${surface.registryId} rule path ${rulePath} has no explicit .read`);
}

const actualBroad=collectBroadReads(candidate).sort();
const declaredBroad=[...contract.broadReadRules].sort();
assert.deepEqual(actualBroad,declaredBroad,'Candidate contains an unregistered broad read or omits a declared broad read');
for(const broadPath of declaredBroad)assert.ok(contract.surfaces.some(surface=>surface.rulePaths.includes(broadPath)),`Broad read ${broadPath} has no registered consumer`);

for(const denied of ['shareDirectory','shareVisibility','shareAccess','trainerShares','userPreferences','groups','shareGroupAccess','accounts','privateProfiles','publicProfiles','publicLists','unlistedShares']){
  assert.equal(candidate[denied]?.['.read'],undefined,`${denied} must remain unreadable in this production candidate`);
}

const adminExpression="root.child('admins').child(auth.uid).val() === true";
for(const adminPath of ['users','authIndex','requests','communities','userCommunities','communityRequests','wishlist','dynamax','gmax','costumes','have','offers','trades']){
  assert.match(String(candidate[adminPath]['.read']),new RegExp(adminExpression.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`${adminPath} broad read must use protected UID authority`);
}
for(const ownerPath of ['users','wishlist','dynamax','gmax','costumes','have']){
  const expression=String(candidate[ownerPath].$username['.read']);
  assert.match(expression,/authUid/);assert.match(expression,/auth\.uid/);assert.doesNotMatch(expression,/isOwner|isAdmin|OWNER|child\(['"]username/);
}
assert.match(String(candidate.authIndex.$uid['.read']),/auth\.uid === \$uid/);
assert.match(String(candidate.userCommunities.$uid['.read']),/auth\.uid === \$uid/);
assert.equal(candidate.loginDirectory['.read'],true);
assert.equal(candidate.publicShares.$username['.read'],true);

execFileSync(process.execPath,[path.join(ROOT,'scripts/check-firebase-reads.js')],{cwd:ROOT,stdio:'pipe'});
console.log(`Narrow-read contract checks passed (${registry.length} mapped surfaces; ${actualBroad.length} registered broad rules).`);
