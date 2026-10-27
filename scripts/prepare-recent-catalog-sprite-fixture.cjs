#!/usr/bin/env node
'use strict';
// Optional local/browser qualification fixture. Original public PNGs only;
// never used to generate application assets or to change production mappings.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const evidence=require('../data/recent-release-coverage.json');
const directory=process.env.CATALOG_SPRITE_CACHE||path.join(os.tmpdir(),'trade-recent-catalog-sprite-cache');
const expected=new Map(require('../data/catalogue-art-checks.json').records.map(row=>[row.url,row.sha256]));
fs.mkdirSync(directory,{recursive:true});
const output=[];
const entries=[...new Map([...evidence.records.filter(r=>r.collection==='dynamax'),...(process.argv.includes('--selectable-repair')?require('../data/catalogue-selectable-repair.json').records:[])].map(row=>[row.no,row])).values()];
for(const entry of entries)for(const shiny of [false,true])for(const female of ([111,112,215,461,464,129,130,350,415].includes(entry.no)?[false,true]:[false])){
 const variant=(shiny?'shiny/':'')+(female?'female/':'')+entry.no+'.png';
 const url='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home/'+variant;
 const file=path.join(directory,variant.replaceAll('/','-'));
 const wanted=expected.get(url);if(!wanted)throw Error('No reviewed content hash for fixture: '+url);
 const reusable=fs.existsSync(file)&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===wanted;
 if(!reusable)execFileSync('curl',['--fail','--silent','--show-error','--max-time','20',url,'-o',file]);
 const bytes=fs.readFileSync(file);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not a PNG: '+url);
 const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(sha256!==wanted)throw Error('Fixture differs from reviewed source hash: '+url);
 output.push({url,file,sha256});
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(output,null,2)+'\n');
console.log(`Cached ${output.length} original PNGs. Set CATALOG_SPRITE_CACHE=${directory} for playwright.catalog-repair.config.cjs.`);
