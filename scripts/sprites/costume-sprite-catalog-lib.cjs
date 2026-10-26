'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {validatePinnedReview}=require('./pinned-pikachu-review.cjs');
const {validateStarterShinyReview}=require('./starter-shiny-review.cjs');
const {validateFormShinyReview}=require('./form-shiny-review.cjs');
const {validateEvolutionShinyReview}=require('./evolution-shiny-review.cjs');

const SCHEMA_VERSION=1;
const SOURCE_ID='pokemondb-go-reviewed';

function normalizeLookupKey(value=''){
  return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
}

function stableJson(value){return`${JSON.stringify(value,null,2)}\n`;}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fail(message){throw new Error(message);}

function validateCatalog(catalog,root){
  if(catalog?.schemaVersion!==SCHEMA_VERSION)fail(`Unsupported costume sprite catalog schema: ${catalog?.schemaVersion}`);
  if(catalog?.source?.id!==SOURCE_ID)fail(`Unexpected costume sprite source: ${catalog?.source?.id}`);
  if(!Array.isArray(catalog.entries)||!catalog.entries.length)fail('Costume sprite catalog must contain entries');
  const aliases=new Map();
  for(const entry of catalog.entries){
    if(!Number.isInteger(entry.no)||entry.no<=0)fail('Every costume sprite entry needs a positive integer dex number');
    if(!Array.isArray(entry.names)||!entry.names.length)fail(`Costume sprite entry ${entry.no} has no lookup names`);
    if(entry.identityStatus!==undefined&&entry.identityStatus!=='released')fail(`Invalid identity status for ${entry.names[0]}`);
    if(!['exact','unavailable'].includes(entry.status))fail(`Invalid costume sprite status for ${entry.names[0]}`);
    for(const name of entry.names){
      const key=normalizeLookupKey(name);
      if(!key)fail(`Blank costume sprite alias for ${entry.names[0]}`);
      const prior=aliases.get(key);
      if(prior&&prior!==entry)fail(`Duplicate costume sprite alias: ${name}`);
      aliases.set(key,entry);
    }
    if(entry.availableGenders){
      if(!Array.isArray(entry.availableGenders)||!entry.availableGenders.length||entry.availableGenders.some(g=>!['m','f'].includes(g))||new Set(entry.availableGenders).size!==entry.availableGenders.length)fail('Invalid reviewed costume genders');
      if(root){const reviewed=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-costume-genders.json'))).records.find(r=>r.name===entry.names[0]);if(!reviewed||JSON.stringify(reviewed.availableGenders)!==JSON.stringify(entry.availableGenders)||!reviewed.evidence?.length)fail('Costume gender review evidence changed');}
    }
    if(entry.status==='unavailable'){
      if(entry.assets||entry.sourceFile||entry.sha256)fail(`Unavailable sprite entry contains an asset: ${entry.names[0]}`);
      continue;
    }
    if(!entry.sourceFile||!entry.sourceLabel)fail(`Exact sprite entry is missing reviewed source evidence: ${entry.names[0]}`);
    if(!entry.assets?.default||!entry.sha256?.default)fail(`Exact sprite entry is missing its default local asset: ${entry.names[0]}`);
    validatePinnedReview(entry,root);
    validateStarterShinyReview(entry,root);
    validateFormShinyReview(entry,root);
    validateEvolutionShinyReview(entry,root);
    if(entry.shinyAvailability!==undefined){
      if(!['released','unreleased','needs-identification'].includes(entry.shinyAvailability))fail('Invalid Shiny availability');
      if(entry.shinyAvailability!=='released'&&root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/reviewed-pikachu-shiny-assets.json'))).availability.find(r=>r.name===entry.names[0]);if(!proof||proof.shinyAvailability!==entry.shinyAvailability||!proof.evidence.length)fail('Unreviewed Shiny availability');}
    }
    if(entry.shinyArtworkReview){
      const forms={'Ash':['ash','003'],'Santa':['santa','001'],'Witch':['halloween','004'],'Summer':['summer','005'],'Flower Crown':['flowers','007'],'Fragment':['fragment','006'],'Straw':['strawhat','009'],'Explorer':['explorer','022'],'Captain':['captain','063'],'Libre':['libre',null],'Rock Star':['rockstar',null],'Pop Star':['popstar',null]};
      const short=entry.names[0].match(/^Pikachu \((.*)\)$/)?.[1],form=forms[short],review=entry.shinyArtworkReview;
      if(!form||review.name!==entry.names[0])fail('Unreviewed classic Shiny identity');
      const [stem,id]=form,source='https://www.serebii.net/pokemongo/pokemon/shiny/025-'+stem+'.png',female=id?'https://raw.githubusercontent.com/Gabrielense/pogorewind/5c6bb56c4026e5fe3cd146910c7e9dad9f07d716/sprites/0025-00-00-'+id+'%2BF%2BS.png':source;
      if(review.sourceUrls.shiny!==source||review.sourceUrls.femaleShiny!==female)fail('Unreviewed classic Shiny source');
      for(const key of ['shiny','femaleShiny'])if(review.assets[key]!==entry.assets[key]||review.sha256[key]!==entry.sha256[key])fail('Classic Shiny mapping drift');
      if(root){const proof=JSON.parse(fs.readFileSync(path.join(root,'data/classic-pikachu-shiny-assets.json'))).records.find(r=>r.name===entry.names[0]);if(JSON.stringify(proof)!==JSON.stringify(review))fail('Classic Shiny review evidence changed');}
    }
    if(entry.sourceProvider==='pokemod-reviewed'){
      const base='https://raw.githubusercontent.com/The-Pokemod-Group/pogo_assets/80a2323099f9c00207a8c9ee20d9386831f6b0ca/Images/Pokemon/Addressable%20Assets/';
      const forms={'Pikachu (Fossil)':'FOSSIL_2026','Pikachu (Marathon)':'VISOR_2026','Pikachu (Mystic)':'GOFEST_2026_CAP_BLUE','Pikachu (Valor)':'GOFEST_2026_CAP_RED','Pikachu (Instinct)':'GOFEST_2026_CAP_YELLOW'};
      const form=forms[entry.names[0]];
      if(!form||entry.sourceCommit!=='80a2323099f9c00207a8c9ee20d9386831f6b0ca')fail('Unreviewed Pokemod identity/commit');
      for(const[key,suffix]of Object.entries({default:'',female:'.g2',shiny:'.s',femaleShiny:'.g2.s'}))if(entry.sourceFiles?.[key]!== 'pm25.f'+form+suffix+'.icon.png'||!entry.assets[key]||!entry.sha256[key])fail('Unreviewed Pokemod variant');
      if(entry.sourceUrl!==base+entry.sourceFiles.default)fail('Unreviewed Pokemod URL');
    }
    if(entry.sourceProvider==='pokemod-reviewed-released'){
      const stems={'Teddiursa Witch Hat':'pm216.cHALLOWEEN_2025','Ursaring Witch Hat':'pm217.cHALLOWEEN_2025','Ursaluna Witch Hat':'pm901.cHALLOWEEN_2025','Galarian Corsola Pink Sunglasses':'pm222.fSPRING_2026','Noibat Headband':'pm714.cHALLOWEEN_2025','Noivern Headband':'pm715.cHALLOWEEN_2025'};
      const stem=stems[entry.names[0]],female=entry.names[0]==='Ursaring Witch Hat';
      if(!stem||entry.sourceCommit!=='80a2323099f9c00207a8c9ee20d9386831f6b0ca'||entry.identityStatus!=='released')fail('Unreviewed released Pokemod identity/commit');
      const sourceBase='https://raw.githubusercontent.com/The-Pokemod-Group/pogo_assets/80a2323099f9c00207a8c9ee20d9386831f6b0ca/Images/Pokemon/Addressable%20Assets/';
      if(entry.sourceUrl!==sourceBase+stem+'.icon.png')fail('Unreviewed released Pokemod URL');
      for(const [key,suffix]of Object.entries({default:'',shiny:'.s',female:female?'.g2':'',femaleShiny:female?'.g2.s':'.s'}))if(!entry.assets?.[key]||entry.sourceFiles?.[key]!==stem+suffix+'.icon.png'||!entry.gitBlobShas?.[key])fail('Unreviewed released Pokemod variant');
      if(root){const reviewed=JSON.parse(fs.readFileSync(path.join(root,'data/pokemod-released-costume-assets.json'))).records.find(r=>r.names[0]===entry.names[0]);if(!reviewed||['sourceCommit','sourceFiles','assets','sha256','gitBlobShas','identityEvidence','shinyEvidence'].some(k=>JSON.stringify(reviewed[k])!==JSON.stringify(entry[k])))fail('Released Pokemod review evidence changed');}
    }
    if(entry.sourceProvider==='margxt-reviewed-friede'){
      const names={"Charmander (Friede's Goggles)":'004-Salameche',"Charmeleon (Friede's Goggles)":'005-Reptincel',"Charizard (Friede's Goggles)":'006-Dracaufeu'},stem=names[entry.names[0]];
      if(!stem||entry.identityStatus!=='released'||entry.sourceUrl!=='https://www.margxt.fr/wp-content/uploads/2026/09/'+stem+'-lunettes-Friede.webp')fail('Unreviewed Friede identity/source');
      for(const[key,suffix]of Object.entries({default:'',shiny:'-shiny',female:'',femaleShiny:'-shiny'}))if(entry.sourceFiles?.[key]!==stem+'-lunettes-Friede'+suffix+'.webp'||!entry.assets?.[key]||!entry.sourceSha256?.[key])fail('Unreviewed Friede variant');
      if(root){const reviewed=JSON.parse(fs.readFileSync(path.join(root,'data/margxt-friede-costume-assets.json'))).records.find(r=>r.names[0]===entry.names[0]);if(!reviewed||['sourcePage','sourceUrl','sourceFiles','sourceSha256','assets','sha256','identityEvidence','shinyEvidence','conversion'].some(k=>JSON.stringify(reviewed[k])!==JSON.stringify(entry[k])))fail('Friede review evidence changed');}
    }
    if(entry.sourceProvider==='dittobase-reviewed'){
      const forms={'Pikachu (Astronaut)':'pikachu-astronaut','Pikachu (Cosmog Spacesuit)':'pikachu-pxp-2026','Pikachu (Worlds 2026)':'pikachu-wcs-2026',"Pikachu (Professor Willow's Assistant)":'pikachu-anniversary-2026','Pikachu (PokeXciting Turquoise)':'pikachu-anniversary-2026-malaysia-01','Pikachu (PokeXciting Blue)':'pikachu-anniversary-2026-singapore-01'};
      const stem=forms[entry.names[0]];if(!stem||entry.sourceUrl!=='https://assets.dittobase.com/go/pokemon-unpadded/25-'+stem+'.png'||entry.sourcePage!=='https://www.dittobase.com/pokemon-go/pokedex/'+stem)fail('Unreviewed Dittobase identity/source');
      for(const[key,suffix]of Object.entries({default:'',shiny:'-shiny',female:'-female',femaleShiny:'-female-shiny'})){
        if((key==='default'||key==='shiny')&&!entry.assets[key])fail('Missing Dittobase exact variant');
        if(entry.assets[key]&&entry.sourceFiles?.[key]!=='25-'+stem+suffix+'.png')fail('Unreviewed Dittobase variant');
      }
      if(root){const reviewed=JSON.parse(fs.readFileSync(path.join(root,'data/dittobase-reviewed-costume-assets.json'))).records.find(r=>r.names[0]===entry.names[0]);if(!reviewed||['sourceFiles','assets','sha256','femaleArtworkUnavailable'].some(k=>JSON.stringify(reviewed[k])!==JSON.stringify(entry[k])))fail('Dittobase review evidence changed');}
    }
    if(entry.sourceProvider==='serebii-reviewed'){
      if(entry.names[0]!=='Pikachu (Cosmog Spacesuit)'||entry.sourceUrl!=='https://www.serebii.net/pokemongo/pokemon/025-xp26.png'||entry.sourceFiles?.shiny!=='shiny/025-xp26.png')fail('Unreviewed Serebii identity/source');
      if(root){const reviewed=JSON.parse(fs.readFileSync(path.join(root,'data/serebii-reviewed-costume-assets.json'))).records.find(r=>r.names[0]===entry.names[0]);if(!reviewed||['sourceFiles','assets','sha256','availableGenders'].some(k=>JSON.stringify(reviewed[k])!==JSON.stringify(entry[k])))fail('Serebii review evidence changed');}
    }
    const variants=['default','female','shiny','femaleShiny'].map(key=>[key,entry.assets[key],entry.sha256[key]]);
    for(const[variant,relative,digest]of variants){
      if(!relative&&!digest)continue;
      if(!relative||!digest)fail(`Incomplete ${variant} asset metadata for ${entry.names[0]}`);
      if(!relative.startsWith('assets/sprites/go/')||path.posix.normalize(relative)!==relative)fail(`Unsafe costume sprite asset path: ${relative}`);
      if(!/^[0-9a-f]{64}$/.test(digest))fail(`Invalid costume sprite digest: ${relative}`);
      if(root){
        const absolute=path.join(root,relative);
        if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())fail(`Missing costume sprite asset: ${relative}`);
        const actual=sha256File(absolute);
        if(actual!==digest)fail(`Costume sprite digest mismatch: ${relative}`);
      }
    }
  }
  return catalog;
}

function runtimeSource(catalog){
  validateCatalog(catalog);
  const rows=catalog.entries.map(entry=>({
    no:entry.no,
    ...(entry.identityStatus?{identityStatus:entry.identityStatus}:{}),
    names:entry.names,
    ...(entry.availableGenders?{availableGenders:entry.availableGenders}:{}),
    ...(entry.shinyAvailability?{shinyAvailability:entry.shinyAvailability}:{}),
    status:entry.status,
    defaultUrl:entry.assets?.default||'',
    femaleUrl:entry.assets?.female||'',
    ...(entry.femaleArtworkUnavailable?{femaleArtworkUnavailable:true}:{}),
    ...(entry.assets?.shiny?{shinyUrl:entry.assets.shiny,femaleShinyUrl:entry.assets.femaleShiny||''}:{}),
    sourceLabel:entry.sourceLabel||'',
    unavailableReason:entry.unavailableReason||''
  }));
  return`(function(global){\n  'use strict';\n  const root=global.PogoDomain=global.PogoDomain||{};\n  const rows=${JSON.stringify(rows)};\n  function normalize(value=''){return String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\\s+/g,' ');}\n  const byName=new Map();\n  for(const row of rows)for(const name of row.names)byName.set(normalize(name),Object.freeze(row));\n  function resolve(input={}){\n    const names=Array.isArray(input.names)?input.names:[input.name];\n    for(const name of names){const row=byName.get(normalize(name));if(row)return row;}\n    return null;\n  }\n  function resolution(input={}){\n    const row=resolve(input);\n    if(!row)return Object.freeze({knownVariant:false,status:'unknown',urls:Object.freeze([]),record:null});\n    if(row.status!=='exact')return Object.freeze({knownVariant:true,status:'unavailable',urls:Object.freeze([]),record:row});\n    const requested=String(input.gender||'').toLowerCase();\n    if(requested&&row.availableGenders&&!row.availableGenders.includes(requested))return Object.freeze({knownVariant:true,status:'unavailable',reason:'invalid-gender',urls:Object.freeze([]),record:row});\n    const gender=requested||((row.availableGenders?.length===1)?row.availableGenders[0]:'');\n    const urls=[];\n    if(gender==='f'&&row.femaleArtworkUnavailable)return Object.freeze({knownVariant:true,status:'unavailable',urls:Object.freeze([]),record:row});\n    if(input.shiny===true&&row.shinyAvailability&&row.shinyAvailability!=='released')return Object.freeze({knownVariant:true,status:'unavailable',reason:row.shinyAvailability,urls:Object.freeze([]),record:row});\n    if(input.shiny===true){const url=gender==='f'?row.femaleShinyUrl:row.shinyUrl;return Object.freeze({knownVariant:true,status:url?'exact':'unavailable',urls:Object.freeze(url?[url]:[]),record:row});}\n    if(gender==='f'&&row.femaleUrl)urls.push(row.femaleUrl);\n    if(!urls.length&&row.defaultUrl)urls.push(row.defaultUrl);\n    return Object.freeze({knownVariant:true,status:'exact',urls:Object.freeze(urls),record:row});\n  }\n  root.costumeSpriteCatalog=Object.freeze({schemaVersion:${SCHEMA_VERSION},sourceId:${JSON.stringify(SOURCE_ID)},normalize,resolve,resolution,records:Object.freeze(rows)});\n})(window);\n`;
}

module.exports={SCHEMA_VERSION,SOURCE_ID,normalizeLookupKey,stableJson,sha256File,validateCatalog,runtimeSource};
