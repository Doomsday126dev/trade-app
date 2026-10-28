'use strict';
const crypto=require('node:crypto');
const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
const text=s=>String(s).replace(/<[^>]*>/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&(?:eacute|Eacute);/g,'é').replace(/&amp;/g,'&').replace(/&#0*39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
function parseGOInventory(html,url,kind){
 const image=/<img[^>]+src=["'](\/pokemongo\/pokemon\/(?:shiny\/)?(\d+)[^"']*\.png)["'][^>]*>/gi,matches=[...html.matchAll(image)],rows=[];let unavailableSpecies=new Set();
 for(let i=0;i<matches.length;i++){
  const m=matches[i],no=Number(m[2]),body=html.slice(m.index+m[0].length,matches[i+1]?.index??html.length);
  const name=body.match(new RegExp('<a[^>]+href=["\']/pokemongo/pokemon/0*'+no+'\\.shtml["\'][^>]*>([\\s\\S]*?)<\\/a>','i'));
  if(!name)throw Error('Sprite without source identity label: '+m[1]);
  const cell=body.match(/<td class="fooinfo">([\s\S]*?)<\/td>/)?.[1];
  if(!cell)throw Error('Source name cell missing');
  const row={no,name:text(cell.split(/<i\b/i)[0]),sourceSprite:new URL(m[1],url).href,source:url};
  if(kind==='shiny')row.statusText=/Available when encountered/i.test(body)?'Available when encountered':text(body.match(/<td class="fooinfo">([^<]+)<\/td>/)?.[1]||'uncertain');
  else{
   const unavailable=/Not Currently Available/i.test(body);
   const base=new RegExp('/0*'+no+'\\.png$').test(m[1]);if(base&&unavailable)unavailableSpecies.add(no);
   row.availabilityClaim=unavailable?'explicitly-unavailable':unavailableSpecies.has(no)?'form-of-unavailable-species-needs-release-evidence':'listed-without-unavailable-marker';
  }
  rows.push(row);
 }
 if(!rows.length)throw Error('No GO sprite rows parsed; source schema or response changed');
 const ids=rows.map(r=>r.no+'|'+r.sourceSprite+'|'+r.name);if(new Set(ids).size!==ids.length)throw Error('Duplicate source sprite identity');
 return rows;
}
function parseMaxInventory(html,url,kind='dynamax'){const label=kind==='gmax'?'Gigantamax':'Dynamax';const start=html.lastIndexOf('List of '+label+' Capable Pok');if(start<0)throw Error(label+' inventory heading missing');const end=html.indexOf('<h2>',start+1);const section=html.slice(start,end<0?undefined:end);const rows=[];for(const m of section.matchAll(/<a href="\/pokemongo\/pokemon\/(\d+)\.shtml">([^<]+)<\/a>/g)){const row={no:Number(m[1]),name:text(m[2]),source:url};if(!rows.some(r=>r.no===row.no&&r.name===row.name))rows.push(row);}if(rows.length<(kind==='gmax'?10:100))throw Error(label+' inventory empty or contracted');return rows;}
function parseNewsFeed(html,url){
 const links=[];
 const pattern=url.includes('leekduck')?/href=["']([^"']*\/events\/[^"'#?]+)["']/g:/<link>(https:\/\/pokemongohub\.net\/post\/[^<]+)<\/link>/g;
 for(const m of html.matchAll(pattern)){const u=new URL(m[1],url);if(u.origin===new URL(url).origin)links.push(u.href);}
 const result=[...new Set(links)].sort();if(result.length<5||result.length>500)throw Error('News/event index empty or schema changed');return result;
}
async function observeInventories(sources,{fetchImpl=fetch,now=new Date()}={}){
 const observed=structuredClone(sources),observations=[],discoveries=[],removed=[],assetChanges=[],responses=new Map();
 async function fetchSource(url){
  try{
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'PoGo-Trades public catalogue reconciliation'},redirect:'error'});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8000000)throw Error('Source response exceeds bound');
   observations.push({url,status:response.status,sha256:sha256(bytes),bytes:bytes.length,observedAt:now.toISOString()});
   return bytes.toString(/serebii/.test(url)?'latin1':'utf8');
  }catch(error){observations.push({url,status:'failed',error:error.message,observedAt:now.toISOString()});throw Error(url+': '+error.message);}
 }
 // Share the same Max page observation across its two independent sections.
 const get=url=>{if(!responses.has(url))responses.set(url,fetchSource(url));return responses.get(url);};
 const fail=(id,error)=>observed.issues.push({source:id,kind:'live-source-failed',error:error.message});
 for(const [id,kind] of [['normal-inventory','normal'],['shiny-inventory','shiny'],['max-inventory','max'],['gigantamax-inventory','gmax']]){
  try{
   const old=observed.data[id];if(!old?.length)throw Error('Accepted source baseline missing');const urls=[...new Set(old.map(r=>r.source))];let rows=[];
   for(const url of urls){const html=await get(url);rows.push(...(kind==='max'||kind==='gmax'?parseMaxInventory(html,url,kind):parseGOInventory(html,url,kind)));}
   if(rows.length<old.length*.95)throw Error('Source inventory contracted more than5%; review before accepting');
   const key=r=>r.no+'|'+r.sourceSprite+'|'+r.name;const before=new Map(old.map(r=>[key(r),r]));const source=observed.manifest.sources.find(r=>r.id===id);source.firstObservedAt??=source.observedAt;const first=source.firstObservedAt;for(const row of rows)row.discoveredAt=before.has(key(row))?(before.get(key(row)).discoveredAt||first):now.toISOString();const after=new Set(rows.map(key));for(const row of old)if(!after.has(key(row)))removed.push({id:'removed:'+id+':'+key(row),source:id,sourceUrl:row.source,discoveredAt:now.toISOString(),releaseState:'uncertain',artState:'previous-source-row-removed',priority:'urgent',disposition:'source-removal-or-alias-change-needs-review',previous:row});observed.data[id]=rows;observed.manifest.sources.find(r=>r.id===id).observedAt=now.toISOString();
   observed.issues=observed.issues.filter(r=>r.source!==id||r.kind!=='stale-or-failed-source');
  }catch(e){fail(id,e);}
 }
 try{
  const metadata=JSON.parse(await get('https://api.github.com/repos/The-Pokemod-Group/pogo_assets/commits/master'));
  let tree=JSON.parse(await get(metadata.commit.tree.url));
  for(const part of ['Images','Pokemon']){const node=tree.tree?.find(r=>r.path===part&&r.type==='tree');if(!node)throw Error('Mined sprite subtree missing: '+part);tree=JSON.parse(await get(node.url));}
  const record=observed.manifest.sources.find(r=>r.id==='pokemod');
  if(tree.sha!==observed.data.pokemod.sha)tree=JSON.parse(await get(tree.url+'?recursive=1'));else tree=observed.data.pokemod;
  if(tree.truncated||!tree.tree?.length)throw Error('Incomplete mined sprite tree');
  record.firstObservedAt??=record.observedAt;
  const oldFiles=new Map(observed.data.pokemod.tree.map(r=>[r.path,r]));
  tree={...tree,tree:tree.tree.map(file=>({...file,discoveredAt:oldFiles.get(file.path)?.discoveredAt||(oldFiles.has(file.path)?record.firstObservedAt:now.toISOString())}))};
  for(const file of tree.tree.filter(r=>r.path.endsWith('.png'))){const before=oldFiles.get(file.path);if(!before||before.sha!==file.sha)assetChanges.push({id:'asset-change:'+file.path,source:'pokemod',sourceUrl:'https://github.com/The-Pokemod-Group/pogo_assets/tree/'+metadata.sha+'/Images/Pokemon',discoveredAt:now.toISOString(),releaseState:'uncertain',artState:'available-at-source',priority:'urgent',disposition:'mined-art-added-or-changed-needs-review',file,previousBlobSha:before?.sha||null});}
  const currentFiles=new Set(tree.tree.map(r=>r.path));for(const file of oldFiles.values())if(file.path.endsWith('.png')&&!currentFiles.has(file.path))assetChanges.push({id:'asset-removed:'+file.path,source:'pokemod',discoveredAt:now.toISOString(),releaseState:'uncertain',artState:'source-file-removed',priority:'urgent',disposition:'mined-art-removed-needs-review',file});
  observed.data.pokemod=tree;record.commit=metadata.sha;record.observedAt=now.toISOString();record.sourceUpdatedAt=metadata.commit.committer.date;
  observed.issues=observed.issues.filter(r=>r.source!=='pokemod'||r.kind!=='stale-or-failed-source');
 }catch(e){fail('pokemod',e);}
 for(const url of ['https://leekduck.com/events/','https://pokemongohub.net/feed/']){
  try{discoveries.push({sourceUrl:url,links:parseNewsFeed(await get(url),url)});}catch(e){fail(url,e);}
 }
 return{...observed,observations,discoveries,removed,assetChanges};
}
module.exports={parseGOInventory,parseMaxInventory,parseNewsFeed,observeInventories};
