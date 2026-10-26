'use strict';
const {createHash}=require('node:crypto');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
function snapshot(catalog,pending,resolve=()=>null){
 if(!Array.isArray(catalog?.entries)||!catalog.entries.length||!Array.isArray(pending?.entries))throw Error('Catalog or pending inventory unavailable/invalid');
 const seen=new Set();return catalog.entries.map(row=>{
  if(!row.names?.length||!['exact','unavailable'].includes(row.status)||!Number.isInteger(row.no))throw Error('Invalid costume identity');
  const detail=pending.entries.find(p=>p.species?.dex===row.no&&row.names.includes(p.displayIdentity));
  const id=detail?.canonicalCostumeId||row.names.map(n=>resolve(n)?.catalogId).find(Boolean)||`pokemon:${row.no}:standard:legacy:${encodeURIComponent(row.names[0])}`;
  if(seen.has(id))throw Error('Duplicate costume identity '+id);seen.add(id);
  const fields={no:row.no,names:row.names,status:row.status,identityStatus:row.identityStatus||detail?.identityStatus||'',reasonCategory:detail?.reasonCategory||'',assets:row.assets||{},sha256:row.sha256||{},sourceFile:row.sourceFile||'',sourceFemaleFile:row.sourceFemaleFile||'',sourceLabel:row.sourceLabel||'',sourceUrl:row.sourceUrl||'',sourcePage:row.sourcePage||''};
  return{id,identity:row.names[0],gap:row.status==='unavailable',fingerprint:digest(fields)};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
function partition(current,baseline,now=new Date()){
 if(!Array.isArray(current)||!current.length)throw Error('Current coverage input unavailable');
 const start=Date.parse(baseline?.reviewedAt),end=Date.parse(baseline?.expiresAt),time=now.getTime();
 if(baseline?.schemaVersion!==1||!Array.isArray(baseline.records)||!baseline.records.length||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>14*86400000||time<start)throw Error('Reviewed gap baseline unavailable/invalid');
 const old=new Map();for(const r of baseline.records){if(!r.id||!r.identity||typeof r.gap!=='boolean'||!/^[a-f0-9]{64}$/.test(r.fingerprint)||old.has(r.id))throw Error('Invalid baseline record');old.set(r.id,r)}
 const currentIds=new Set(),result={new:[],changed:[],known:[],resolved:[],mappingChanges:[],removedIdentities:[],expired:time>=end,expiresAt:baseline.expiresAt,unresolvedTotal:current.filter(r=>r.gap).length,acknowledgementIsNotArtVerification:true};
 for(const r of current){if(currentIds.has(r.id))throw Error('Duplicate current identity');currentIds.add(r.id);const before=old.get(r.id);
  if(r.gap){if(!before||!before.gap)result.new.push(r);else if(before.fingerprint!==r.fingerprint)result.changed.push(r);else result.known.push(r)}
  if(before?.gap&&!r.gap)result.resolved.push({...r,resolution:'Exact-art record present; review mapping change before acknowledgement.'});
  if(before&&before.fingerprint!==r.fingerprint)result.mappingChanges.push({id:r.id,identity:r.identity,previous:before.fingerprint,current:r.fingerprint});
 }
 for(const r of old.values())if(!currentIds.has(r.id)){result.removedIdentities.push(r);if(r.gap)result.resolved.push({...r,resolution:'Removed from catalog; this is NOT proof of artwork resolution.'})}
 result.requiresReview=result.expired||result.new.length>0||result.changed.length>0||result.mappingChanges.length>0||result.removedIdentities.length>0;
 return result;
}
function validateSource(report,now=new Date(),{allowOffline=false}={}){
 const at=Date.parse(report?.checkedAt),age=now.getTime()-at;
 if(!(report?.status==='no-new-findings'||allowOffline&&report?.status==='offline-check-passed')||!Number.isFinite(at)||age>86400000||age< -300000)throw Error('Source review unavailable, failed, or stale');
 return report.status;
}
module.exports={snapshot,partition,validateSource};
