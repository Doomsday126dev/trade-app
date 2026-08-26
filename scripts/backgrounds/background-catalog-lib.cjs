'use strict';

const crypto=require('node:crypto');

const SCHEMA_VERSION=1;
const CATALOG_AS_OF='2026-08-26';
const SEREBII_URL='https://www.serebii.net/pokemongo/backgrounds.shtml';
const POKEMINERS_REPOSITORY='PokeMiners/pogo_assets';
const POKEMINERS_PATH='Images/LocationCards';
const VALID_TYPES=new Set(['location','special']);
const VALID_STATUSES=new Set(['released','candidate','retired']);
const ID_RE=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONTHS=Object.freeze({january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,octboer:9,november:10,december:11});

const TITLE_CORRECTIONS=Object.freeze({
  'PokeXciting Malaysia':'PokéXciting Malaysia',
  'PokeXciting Taiwan':'PokéXciting Taiwan',
  'PokeXciting Singapore':'PokéXciting Singapore',
  'PokeXciting Phippines':'PokéXciting Philippines',
  'Pokemon Jet Red':'Pokémon Jet Red',
  '2026 Pokemon World Championships':'2026 Pokémon World Championships'
});

function decodeHtml(value){
  const named={amp:'&',apos:"'",quot:'"',nbsp:' ',eacute:'é',Eacute:'É',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”'};
  return String(value||'')
    .replace(/<br\s*\/?\s*>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&#(x?[0-9a-f]+);/gi,(_,raw)=>String.fromCodePoint(raw[0].toLowerCase()==='x'?parseInt(raw.slice(1),16):parseInt(raw,10)))
    .replace(/&([a-z]+);/gi,(all,name)=>Object.prototype.hasOwnProperty.call(named,name)?named[name]:all)
    .replace(/\s+/g,' ').trim();
}

function slugify(value){
  return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').replace(/-+/g,'-');
}

function sourceAssetKey(value){return String(value||'').replace(/\.[^.]+$/,'').trim();}
function normalizePokemonName(value){return String(value||'').replace(/\s*\(\s*\)\s*$/,'').replace(/\s+/g,' ').trim();}

function yearFromAvailability(value){
  const years=[...String(value||'').matchAll(/\b(20\d{2})\b/g)].map(match=>Number(match[1]));
  return years.length?Math.min(...years):null;
}

function availabilityEnd(value){
  const text=String(value||'').toLowerCase();
  const years=[...text.matchAll(/\b(20\d{2})\b/g)].map(match=>Number(match[1]));
  const year=years.length?Math.max(...years):null;if(!year)return null;
  const monthMatches=[...text.matchAll(new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`,'g'))];
  const dayMatches=[...text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)].map(match=>Number(match[1])).filter(day=>day>=1&&day<=31);
  if(!monthMatches.length||!dayMatches.length)return null;
  const month=MONTHS[monthMatches.at(-1)[1]];
  const day=dayMatches.at(-1);
  const date=new Date(Date.UTC(year,month,day,23,59,59,999));
  return Number.isNaN(date.getTime())?null:date;
}

function availabilityStart(value){
  const text=String(value||'').toLowerCase(),year=yearFromAvailability(text);if(!year)return null;
  const month=text.match(new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`));
  const day=text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if(!month||!day)return null;
  const date=new Date(Date.UTC(year,MONTHS[month[1]],Number(day[1])));
  return Number.isNaN(date.getTime())?null:date;
}

function releasedStatus(availability,asOf=CATALOG_AS_OF){
  const start=availabilityStart(availability),boundary=new Date(`${asOf}T23:59:59.999Z`);
  return start&&start>boundary?'candidate':'released';
}

function eventAndLocation(displayName,type){
  const year=yearFromAvailability(displayName);
  const clean=displayName.replace(/\b20\d{2}\b/g,'').replace(/\s+/g,' ').trim();
  const patterns=[
    [/^GO Fest\s+/i,'Pokémon GO Fest'],[/^City Safari\s+/i,'Pokémon GO City Safari'],
    [/^GO Tour\s+/i,'Pokémon GO Tour'],[/^GO Wild Area\s+/i,'Pokémon GO Wild Area'],
    [/^Air Adventures\s+/i,'Pokémon Air Adventures'],[/^PokéXciting\s+/i,'PokéXciting'],
    [/^Pokémon Center\s+/i,'Pokémon Center'],[/^National Trust\s+/i,'National Trust']
  ];
  if(type==='special')return{event:displayName,location:null};
  for(const[pattern,event]of patterns){
    if(pattern.test(clean))return{event:year?`${event} ${year}`:event,location:clean.replace(pattern,'').trim()||null};
  }
  return{event:null,location:null};
}

function compactName(displayName,year,location){
  let short=location||displayName;
  short=short.replace(/^Pokémon GO\s+/i,'').replace(/^Pokémon\s+/i,'').replace(/\s+/g,' ').trim();
  if(year&&!new RegExp(`\\b${year}\\b`).test(short))short+=` ${year}`;
  return short.length<=36?short:`${short.slice(0,33).trim()}…`;
}

function aliasesFor(record,assetKey){
  const values=[record.displayName,record.shortName,record.event,record.location,String(record.year||''),assetKey.replace(/[_-]+/g,' ')];
  if(/new york city/i.test(record.displayName))values.push('NYC','New York');
  if(/world championships/i.test(record.displayName))values.push('Worlds','WCS');
  if(/go fest/i.test(record.displayName))values.push('Pokémon GO Fest');
  if(/city safari/i.test(record.displayName))values.push('Pokémon GO City Safari');
  return[...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))];
}

function parseSection(html,type,startLabel,endLabel){
  const start=html.indexOf(startLabel);if(start<0)throw new Error(`Missing background section: ${startLabel}`);
  const end=endLabel?html.indexOf(endLabel,start+startLabel.length):html.length;
  const section=html.slice(start,end<0?html.length:end);
  const cells=[...section.matchAll(/<td class="(fooevo|cen|fooinfo)"[^>]*>([\s\S]*?)<\/td>/gi)].map(match=>({className:match[1].toLowerCase(),html:match[2]}));
  const titles=cells.filter(cell=>cell.className==='fooevo').map(cell=>decodeHtml(cell.html));
  const assetCells=cells.filter(cell=>cell.className==='cen'&&/locationcard\/th\//i.test(cell.html));
  const dateCells=cells.filter(cell=>cell.className==='cen'&&!/locationcard\/th\//i.test(cell.html));
  const pokemonCells=cells.filter(cell=>cell.className==='fooinfo');
  if(!titles.length||titles.length!==assetCells.length||titles.length!==dateCells.length||titles.length!==pokemonCells.length){
    throw new Error(`Malformed ${type} background table: ${titles.length}/${assetCells.length}/${dateCells.length}/${pokemonCells.length}`);
  }
  return titles.map((title,index)=>{
    const asset=assetCells[index].html.match(/locationcard\/th\/([^"']+)/i)?.[1];
    if(!asset)throw new Error(`Missing source asset for ${title}`);
    return{
      type,
      sourceTitle:title,
      assetKey:sourceAssetKey(asset),
      availability:decodeHtml(dateCells[index].html),
      pokemon:[...pokemonCells[index].html.matchAll(/<u>([\s\S]*?)<\/u>/gi)].map(match=>normalizePokemonName(decodeHtml(match[1]))).filter(Boolean)
    };
  });
}

function parseSerebiiCatalog(html){
  return[
    ...parseSection(html,'location','List of Location Backgrounds','List of Special Backgrounds'),
    ...parseSection(html,'special','List of Special Backgrounds',null)
  ];
}

function normalizeRows(rows,{existingCatalog=null,asOf=CATALOG_AS_OF,retrievedAt=asOf}={}){
  const existingBySource=new Map((existingCatalog?.backgrounds||[]).map(record=>[`${record.type}:${record.source?.assetKey}`,record]));
  const seenSources=new Set(),seenIds=new Set(),backgrounds=[];
  for(const row of rows){
    const sourceKey=`${row.type}:${row.assetKey}`;
    if(seenSources.has(sourceKey))continue;
    seenSources.add(sourceKey);
    const displayName=TITLE_CORRECTIONS[row.sourceTitle]||row.sourceTitle.replace(/\bPokemon\b/g,'Pokémon');
    const year=yearFromAvailability(row.availability);
    const{event,location}=eventAndLocation(displayName,row.type);
    const prior=existingBySource.get(sourceKey);
    let id=prior?.id||`${row.type}-${slugify(row.assetKey)}`;
    if(!ID_RE.test(id))throw new Error(`Invalid generated background ID: ${id}`);
    if(seenIds.has(id))id=`${id}-${slugify(row.type)}`;
    seenIds.add(id);
    const record={
      id,displayName,shortName:compactName(displayName,year,location),type:row.type,
      event,location,year,aliases:[],pokemon:[...new Set(row.pokemon)],
      availability:row.availability,status:releasedStatus(row.availability,asOf),
      source:{catalogId:'serebii-backgrounds',assetKey:row.assetKey,retrievedAt}
    };
    record.aliases=aliasesFor(record,row.assetKey);
    backgrounds.push(record);
  }
  backgrounds.sort((a,b)=>a.type.localeCompare(b.type)||(b.year||0)-(a.year||0)||a.displayName.localeCompare(b.displayName,'en',{sensitivity:'base'})||a.id.localeCompare(b.id));
  return{
    schemaVersion:SCHEMA_VERSION,catalogVersion:asOf,asOf,
    sources:[
      {id:'serebii-backgrounds',url:SEREBII_URL,role:'normalized event, location, availability, and eligible-Pokémon interpretation',retrievedAt},
      {id:'pokeminers-location-cards',url:`https://github.com/${POKEMINERS_REPOSITORY}/tree/master/${POKEMINERS_PATH}`,role:'machine-oriented addition and removal signal; artwork is not redistributed'},
      {id:'pokemon-go-live-official',url:'https://pokemongolive.com/',role:'official terminology and ambiguous recent-event confirmation'}
    ],
    backgrounds
  };
}

function canonicalString(value){return JSON.stringify(value);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}

function validateCatalog(catalog){
  const errors=[],ids=new Set(),sourceKeys=new Set();
  if(catalog?.schemaVersion!==SCHEMA_VERSION)errors.push('catalog schemaVersion must be 1');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(catalog?.asOf||''))errors.push('catalog asOf must be YYYY-MM-DD');
  if(!Array.isArray(catalog?.backgrounds))errors.push('backgrounds must be an array');
  for(const record of catalog?.backgrounds||[]){
    if(!ID_RE.test(record?.id||''))errors.push(`invalid id: ${record?.id}`);
    if(ids.has(record.id))errors.push(`duplicate id: ${record.id}`);ids.add(record.id);
    if(!record.displayName||!record.shortName)errors.push(`missing display label: ${record.id}`);
    if(!VALID_TYPES.has(record.type))errors.push(`invalid type: ${record.id}`);
    if(!VALID_STATUSES.has(record.status))errors.push(`invalid status: ${record.id}`);
    if(record.year!==null&&(!Number.isInteger(record.year)||record.year<2016||record.year>2100))errors.push(`invalid year: ${record.id}`);
    if(!Array.isArray(record.aliases)||new Set(record.aliases).size!==record.aliases.length)errors.push(`invalid aliases: ${record.id}`);
    if(!Array.isArray(record.pokemon)||new Set(record.pokemon).size!==record.pokemon.length)errors.push(`invalid pokemon: ${record.id}`);
    const sourceKey=`${record.type}:${record.source?.assetKey||''}`;
    if(!record.source?.catalogId||!record.source?.assetKey)errors.push(`missing source metadata: ${record.id}`);
    if(sourceKeys.has(sourceKey))errors.push(`duplicate released source record: ${sourceKey}`);sourceKeys.add(sourceKey);
  }
  const sorted=[...(catalog?.backgrounds||[])].sort((a,b)=>a.type.localeCompare(b.type)||(b.year||0)-(a.year||0)||a.displayName.localeCompare(b.displayName,'en',{sensitivity:'base'})||a.id.localeCompare(b.id));
  if(canonicalString(sorted)!==canonicalString(catalog?.backgrounds||[]))errors.push('backgrounds are not deterministically sorted');
  const released=(catalog?.backgrounds||[]).filter(record=>record.status==='released').length;
  if(released<100)errors.push(`released catalog is unexpectedly small: ${released}`);
  return{ok:errors.length===0,errors,released,candidates:(catalog?.backgrounds||[]).filter(record=>record.status==='candidate').length,total:(catalog?.backgrounds||[]).length,digest:sha256(`${canonicalString(catalog)}\n`)};
}

function detectUpstreamChanges(snapshot,currentFiles){
  const known=new Set(snapshot?.files||[]),current=new Set(currentFiles||[]);
  return{
    added:[...current].filter(file=>!known.has(file)).sort(),
    removed:[...known].filter(file=>!current.has(file)).sort()
  };
}

function mappingReviewCandidates(catalog){
  return(catalog?.backgrounds||[])
    .filter(record=>!Array.isArray(record.pokemon)||record.pokemon.length===0)
    .map(record=>({id:record.id,reason:'eligible-pokemon-unmapped'}));
}

function buildSnapshot({commit,files,retrievedAt=CATALOG_AS_OF}){
  return{schemaVersion:1,source:{repository:POKEMINERS_REPOSITORY,path:POKEMINERS_PATH},sourceCommit:commit,retrievedAt,files:[...new Set(files)].sort()};
}

module.exports={
  SCHEMA_VERSION,CATALOG_AS_OF,SEREBII_URL,POKEMINERS_REPOSITORY,POKEMINERS_PATH,ID_RE,
  decodeHtml,slugify,normalizePokemonName,yearFromAvailability,availabilityStart,availabilityEnd,releasedStatus,parseSerebiiCatalog,
  normalizeRows,validateCatalog,detectUpstreamChanges,mappingReviewCandidates,buildSnapshot,canonicalString,sha256
};
