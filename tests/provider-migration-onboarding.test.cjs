'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(__dirname,'../js/dev/providerMigrationOnboarding.js');
const A=`v1_${'a'.repeat(64)}`,B=`v1_${'b'.repeat(64)}`,L=`v1_${'c'.repeat(64)}`,NOW=1_800_000_000_000;
function harness(options={}){
  const window={};vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,Set,Object,Number,Date,JSON,TypeError,String});
  const api=window.PogoDev.providerMigrationOnboarding,values=new Map(),calls=[];
  let current={ownerBinding:A,lifecycleBinding:L,accountReady:true,legacyPinUsable:true,linkedProviders:[],availableProviders:['google','discord'],...options.session},now=NOW;
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
  const create=(extra={})=>api.createProviderMigrationOnboarding({enabled:true,eligibleOwnerBindings:[A,B],storage,getSession:()=>current,
    openSecurity:async input=>{calls.push(input);await options.openSecurity?.(input);},clock:()=>now,...extra});
  return{api,create,values,calls,set:value=>{current={...current,...value};},advance:ms=>{now+=ms;}};
}
test('default off, exact canary enrollment and usable replacement are required',()=>{
  const h=harness();for(const options of[{enabled:false},{eligibleOwnerBindings:[]}])assert.equal(h.create(options).claim().eligible,false);
  for(const patch of[{accountReady:false},{legacyPinUsable:false},{availableProviders:[]},{ownerBinding:'raw-firebase-uid'}]){
    const x=harness({session:patch});assert.equal(x.create().claim().eligible,false);
  }
});
test('notice only offers configured replacements and disappears once either is linked',()=>{
  const h=harness({session:{availableProviders:['google']}});const result=h.create().claim();assert.deepEqual([...result.providers],['google']);
  for(const provider of['google','discord']){const x=harness({session:{linkedProviders:[provider]}});assert.equal(x.create().claim().eligible,false);}
});
test('claim rate limits navigation, reload and browser restarts for 30 days',()=>{
  const h=harness(),c=h.create();assert.equal(c.claim().eligible,true);assert.equal(c.claim().eligible,false);
  assert.equal(h.create().claim().eligible,false);h.advance(h.api.REMINDER_MS-1);assert.equal(h.create().claim().eligible,false);
  h.advance(1);assert.equal(h.create().claim().eligible,true);
});
test('dismissal never triggers export, account creation, unlink or PIN cutoff',()=>{
  const h=harness(),c=h.create();c.claim();assert.equal(c.dismiss(),true);assert.deepEqual(h.calls,[]);
  h.advance(h.api.REMINDER_MS);assert.equal(h.create().claim().eligible,true);
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/deleteUser|createUser|exportData|\.unlink\(|disablePin|firebase|fetch\(/);
});
test('permanent opt-out persists beyond reminder window and is per account',()=>{
  const h=harness(),c=h.create();c.claim();c.dismiss({mute:true});h.advance(h.api.REMINDER_MS*100);
  assert.equal(h.create().claim().eligible,false);h.set({ownerBinding:B});assert.equal(h.create().claim().eligible,true);
});
test('broken, unavailable or malformed local storage suppresses notifications',()=>{
  const h=harness();h.values.set(`${h.api.PREFIX}${A}`,'{"schemaVersion":99}');assert.equal(h.create().claim().eligible,false);
  assert.equal(h.create({storage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}}).claim().eligible,false);
  assert.equal(h.create({storage:{getItem(){return null;},setItem(){throw Error('quota');}}}).claim().eligible,false);
});
test('provider review opens security with exact owner guards and contains no raw identity',async()=>{
  const h=harness(),c=h.create();c.claim();assert.equal((await c.review('google')).ok,true);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].providerKey,'google');assert.equal(h.calls[0].ownerBinding,A);assert.equal(h.calls[0].isCurrent(),true);
  assert.doesNotMatch(JSON.stringify([...h.values]),/uid|pin|token|secret|password/);
});
test('session change and disabled provider block action from an old notice',async()=>{
  const h=harness(),c=h.create();c.claim();h.set({ownerBinding:B});assert.equal((await c.review('discord')).ok,false);assert.equal(h.calls.length,0);
  const h2=harness(),c2=h2.create();c2.claim();h2.set({availableProviders:['google']});assert.equal((await c2.review('discord')).code,'provider-unavailable');assert.equal(h2.calls.length,0);
});
test('stale dismissal cannot mute another account and a failed navigation can retry safely',async()=>{
  const h=harness(),c=h.create();c.claim();h.set({ownerBinding:B});assert.equal(c.dismiss({mute:true}),false);assert.equal(h.values.has(`${h.api.PREFIX}${B}`),false);
  const x=harness({openSecurity:async()=>{throw Error('offline');}}),controller=x.create();controller.claim();
  assert.equal((await controller.review('google')).code,'open-failed');assert.equal(controller.isCurrent(),true);
});
test('account switch during security navigation rejects the obsolete result',async()=>{
  let h;h=harness({openSecurity:async()=>h.set({lifecycleBinding:B})});const c=h.create();c.claim();
  assert.equal((await c.review('google')).code,'session-changed');assert.equal(c.isCurrent(),false);
});
