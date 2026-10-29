'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{hash,observationHash,loadContext,summarize,markdown}=require('../scripts/catalogue-review-summary.cjs');
function fixture(){
 const row={id:'mined:6',no:6,token:'',source:'pokemod',releaseState:'uncertain',files:[{path:'pm6.icon.png',gitBlobSha:'normal-blob'},{path:'pm6.s.icon.png',gitBlobSha:'shiny-blob'}]};
 const context={identities:{all:[{name:'Charizard',no:6,catalogId:'base'}]},proofs:new Map([['base',[{variant:'normal',url:'https://example.test/normal',sha256:'a'.repeat(64),gitBlobSha:'normal-blob'}]]]),fingerprint:id=>hash({id,proofs:context.proofs.get(id)})};
 const register={schemaVersion:1,rows:[{id:row.id,observationHash:observationHash(row),category:'base-namespace-runtime-proof-join',catalogId:'base',runtimeFingerprint:context.fingerprint('base')}],knownIssues:[{no:778,name:'Mimikyu (Busted Form)',kind:'qualified-art-identity-absence',state:'battle state; scope undecided',action:'Review scope without claiming a separately obtainable form.'}]};
 return{report:{queue:[row]},register,context};
}
test('normal source/hash evidence never closes missing Shiny and raw rows remain immutable',()=>{
 const f=fixture(),before=JSON.stringify(f.report),r=summarize(f.report,f.register,f.context);assert.equal(r.rows[0].variants.normal.sourceOriginalMatches,true);assert.equal(r.rows[0].variants.shiny.runtimeArtQualified,false);assert.equal(r.rows[0].variants.shiny.sourceOriginalMatches,false);assert.equal(r.counts['evidence-join-backlog'],1);assert.equal(JSON.stringify(f.report),before);
 f.report.queue[0].files[1].gitBlobSha='normal-blob';f.register.rows[0].observationHash=observationHash(f.report.queue[0]);assert.equal(summarize(f.report,f.register,f.context).rows[0].variants.shiny.sourceOriginalMatches,false);
});
test('changed source blob or removed variant re-enters actionable review; fetch time alone does not',()=>{
 const f=fixture();f.report.queue[0].discoveredAt='later';assert.equal(summarize(f.report,f.register,f.context).rows[0].sourceUnchanged,true);
 f.report.queue[0].files[1].gitBlobSha='changed';assert.equal(summarize(f.report,f.register,f.context).rows[0].category,'unreviewed-or-changed-source-evidence');f.report.queue[0].files.pop();assert.equal(summarize(f.report,f.register,f.context).counts['changed-review'],1);
});
test('changed selector, exact URL or hash invalidates the corresponding runtime proof',()=>{
 const f=fixture();f.context.identities.all=[];assert.equal(summarize(f.report,f.register,f.context).rows[0].category,'selectable-identity-changed');f.context.identities.all=[{catalogId:'base'}];f.context.proofs.get('base')[0].url='https://example.test/changed';const changed=summarize(f.report,f.register,f.context).rows[0];assert.equal(changed.category,'runtime-route-or-proof-changed');assert.equal(changed.variants.normal.runtimeArtQualified,false);
 f.context.proofs.get('base')[0].sha256='b'.repeat(64);assert.equal(summarize(f.report,f.register,f.context).rows[0].runtimeUnchanged,false);
});
test('known finite absences remain visible independently of an old zero minimum',()=>{
 const f=fixture();f.report.reviewSummary={actionableMissing:[]};const r=summarize(f.report,f.register,f.context);assert.equal(r.knownIssues[0].currentlySelectable,false);assert.match(markdown(r),/Mimikyu \(Busted Form\).*not selectable/);assert.doesNotMatch(markdown(r),/minimum missing.*0/);
});
test('policy and owner clarification remain retained inputs rather than missing-art hunts',()=>{
 const f=fixture();for(const category of ['policy-exclusion','owner-clarification','temporary-or-battle-scope']){f.register.rows[0].category=category;const r=summarize(f.report,f.register,f.context);assert.equal(r.counts['retained-policy-or-input'],1);assert.equal(r.rows.length,1);}
 f.report.queue.push({id:'unknown',source:'unknown',disposition:'new'});assert.equal(summarize(f.report,f.register,f.context).counts['changed-review'],1);
});
test('review register rejects ambiguous duplicate pins without suppressing raw evidence',()=>{const f=fixture();f.register.rows.push(f.register.rows[0]);assert.throws(()=>summarize(f.report,f.register,f.context),/duplicate/);});
test('real crosswalk distinguishes base/costume and current Gigantamax ID; upcoming facts stay passive',()=>{
 const root=path.resolve(__dirname,'..'),context=loadContext(root),register=JSON.parse(fs.readFileSync(path.join(root,'data/catalogue-sources/review-crosswalk.json')));
 assert.equal(register.rows.length,1811);assert.equal(register.provenance.rawReportSha256,'bcfc0bcb0e2b3c559c21398b04c58d84a065fabd8ece29861a4295c737124f80');
 assert.equal(register.rows.find(r=>r.id==='mined:6').targetName,'Charizard');assert.equal(register.rows.find(r=>r.id==='mined:94.fGIGANTAMAX').catalogId,'pokemon:94:gmax:legacy:Gengar%20(Gigantamax)');
 assert.equal(register.knownIssues.filter(r=>r.kind==='missing-exact-art').length,3);assert.equal(register.knownIssues.filter(r=>['qualified-early-want-addition','battle-state-scope-decision','state-art-and-scope-decision'].includes(r.kind)).length,8);
 for(const name of ['Greavard','Mega Chandelure']){const r=register.knownIssues.find(r=>r.name===name);assert.equal(r.autoPromote,false);assert.equal(r.timeBasis,'event-local');}
 assert.equal(register.knownIssues.find(r=>r.name==='Greavard').localStart,'2026-11-01T10:00:00');assert(context.identities.all.some(r=>r.name==='Greavard'));
 const now=new Date('2026-10-28T14:00:00Z'),raw=require('../scripts/reconcile-catalogue.cjs').build(now),before=JSON.stringify(raw);const result=summarize(raw,register,context);assert.equal(result.rows.length,raw.queue.length);assert.equal(JSON.stringify(raw),before);assert.equal(Object.values(result.counts).reduce((a,b)=>a+b,0),raw.queue.length);assert(result.knownIssues.some(r=>r.kind==='missing-exact-art'));
});
test('sprite fingerprint ignores unrelated UI but observes resolver bodies, call arguments and constants',()=>{
 const {applicationSpriteScope:scope}=require('../scripts/catalogue-resolver-fingerprint.cjs');
 const source='const SPRITE_BASE="a"; function helper(){return SPRITE_BASE;} function spriteUrl(e){return helper()+e.shiny;} function spriteFallbackChain(e){return [spriteUrl(e)];} function spriteImg(e){return spriteUrl(e);} function exportSpriteUrl(e){return spriteUrl(e);} function renderCard(e){return spriteImg(e);} function favorites(){return "old";}';
 const initial=scope(source).hash;
 assert.equal(scope(source.replace('"old"','"new"')).hash,initial);
 assert.equal(scope(source+'\n// formatting only').hash,initial);
 for(const next of [source.replace('SPRITE_BASE="a"','SPRITE_BASE="b"'),source.replace('return helper()+e.shiny','return helper()+false'),source.replace('return spriteImg(e)','return spriteImg({shiny:false})')])assert.notEqual(scope(next).hash,initial);
 assert.throws(()=>scope('function spriteUrl(){}'),/scope missing/);
});
test('discovery summary puts missing Max names and changed miner compare link before retained backlog',()=>{
 const {actionable,annotation}=require('../scripts/catalogue-review-summary.cjs'),f=fixture();
 f.report.queue.push({id:'a',sourceUrl:'https://example.test/season',releaseState:'uncertain',finding:{kind:'announced-max-missing-catalog',type:'dynamax',name:'Mawile'}},{id:'b',source:'pokeminers-head',sourceUrl:'https://example.test/head',reviewedCommit:'a'.repeat(40),observedCommit:'b'.repeat(40),artState:'needs-review',disposition:'secondary-miner-change-review-required'});
 const summary=summarize(f.report,f.register,f.context),md=markdown(summary);assert.equal(actionable(f.report).length,2);assert(md.indexOf('dynamax Mawile')<md.indexOf('Mimikyu'));assert.match(md,/compare\/a{40}\.\.\.b{40}/);assert.equal(summary.rows.length,3);
 const note=annotation({...f.report,sourceIssues:[],actionSummary:summary});assert.match(note,/dynamax Mawile/);assert.match(annotation({queue:[],sourceIssues:[{source:'feed\n::warning::injected',kind:'failed'}]}),/%0A::warning/);
});
