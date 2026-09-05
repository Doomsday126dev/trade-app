// Read-only source inspection; generated reports contain no account data.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {babelParse}=require('../node_modules/playwright/lib/transform/babelBundle.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/product-audit');
fs.mkdirSync(out,{recursive:true});
const files=cp.execFileSync('git',['ls-tree','-r','--name-only','-z','794f8dbe08ee30a7de29ca73013b5ad77070ad44'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const csv=(rows,columns)=>[columns,...rows.map(row=>columns.map(key=>String(row[key]??'')))].map(row=>row.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
const suiteFiles=files.filter(f=>/\.(test\.cjs|spec\.js)$/.test(f));
const overrides={
  'tests/public-share-localization.test.cjs':['DUPLICATE COVERAGE','CONSOLIDATE','Retain locale parity; anonymous-public-share.spec.js owns actual recipient copy/switch/privacy. Keep signed-in rendering assertions until an equivalent route test survives.'],
  'tests/ui-readiness.test.cjs':['IMPLEMENTATION-DETAIL','CONSOLIDATE','Move syntax enumeration to one syntax command; preserve unique loader-boundary assertions with frontend-asset-extraction and client-asset-versioning.'],
  'tests/design-system.test.cjs':['IMPLEMENTATION-DETAIL','KEEP','Token/source guard, not proof of visual quality; keep until focused screenshots cover its unique token constraints.'],
  'tests/trusted-readiness.spec.js':['HIGH-VALUE REGRESSION','CONSOLIDATE','Retain product journey and 320/390/430/1440 geometry; remove only identical 375/1728 iterations. Unique editing/export checks survive here.'],
  'tests/visual-smoke.spec.js':['SCHEDULED/DEEP ONLY','MOVE TO DEEP/NIGHTLY','Broad screenshots remain available; anonymous-public-share and trusted-readiness protect fast recipient and editing journeys.'],
  'tests/cross-browser-accessibility.spec.js':['SCHEDULED/DEEP ONLY','MOVE TO DEEP/NIGHTLY','Keep extended engine coverage; retain changed-dialog keyboard checks in focused PR tests.'],
  'tests/admin-legacy-ia.test.cjs':['RETIRED-FEATURE','KEEP','Retirement guard protects hidden actions and preserved read-only archive; not obsolete merely because inventory editing retired.'],
  'tests/trainer-first-interim.test.cjs':['RETIRED-FEATURE','KEEP','Preserves legacy records and prevents old offer/community mutation paths from becoming reachable.'],
  'tests/trusted-user-wave1-preparation.test.cjs':['IMPLEMENTATION-DETAIL','KEEP','Historical readiness checks: inspect unique assertions before deletion; no new human acceptance gate.']
};
function classify(file,source){
  if(overrides[file])return overrides[file];
  if(/browser-operator|browser-harness|canary-setup|client-foundation-execution|third-mutation-candidate|private-identity/.test(file))
    return ['PRIVATE/MANUAL','KEEP','Offline operator guard remains required when operator code changes; live execution is separately authorized, never a routine PR task.'];
  if(/performance\.spec|staging-(readiness|recommendations|decision|resource|creation)/.test(file))
    return ['SCHEDULED/DEEP ONLY','MOVE TO DEEP/NIGHTLY','Retain scenario coverage and run on owning-area changes; omit unrelated product edits. Not permission to run live infrastructure.'];
  if(file.startsWith('functions/test/')||/account-sync|auth|identity|provider|rules|security|admin-reset|pin-reset|firebase|public-share|public-projection|service-worker|pages-deployment|client-asset|session-|subscription|listener-|owned-|migration|freeze|e1-|group-e|trusted-backend|request-access|sec02|share-visibility/.test(file))
    return ['CRITICAL CONTRACT','KEEP','Ownership, persistence, privacy, admission, release or recovery contract; keep isolated models AND adapter/Rules coverage. They are different failure boundaries.'];
  if(/\.spec\.js$/.test(file)||/sprite|background|search-syntax|comparison|trade-match|async-races|my-list|favorite|localization|i18n/.test(file))
    return ['HIGH-VALUE REGRESSION','KEEP','Protects user-visible rendering, exact intent, data transformation or interaction; run on relevant changes.'];
  if(/assert\.(?:match|doesNotMatch)\(/.test(source)&&!/vm\.run|createContext/.test(source))
    return ['IMPLEMENTATION-DETAIL','KEEP','Source-shape assertions are weaker than behavior; no deletion until the unique invariant is mapped to a surviving behavioral assertion.'];
  return ['USEFUL FOCUSED','KEEP','Focused domain/UX contract; keep selected by dependency impact rather than every package alias.'];
}
function inspect(file){
  const source=read(file),ast=babelParse(source,file,false);
  const tests=[],functions=[];
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration')functions.push({name:node.id?.name,line:node.loc.start.line});
    if(node.type==='CallExpression'){
      let callee=node.callee,names=[];
      while(callee?.type==='MemberExpression'){names.unshift(callee.property.name);callee=callee.object;}
      if(callee?.type==='Identifier'&&['test','it'].includes(callee.name)&&!names.includes('describe')){
        const title=node.arguments[0];
        if(title?.type==='StringLiteral'||title?.type==='TemplateLiteral')tests.push({line:node.loc.start.line,title:title.value??source.slice(title.start,title.end)});
      }
    }
    for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'&&value.type)visit(value);}
  };
  visit(ast);
  return {source,tests,functions};
}
const suites=[],cases=[];
for(const file of suiteFiles){
  const {source,tests}=inspect(file),[category,action,rationale]=classify(file,source);
  suites.push({file,category,action,declarations:tests.length,lines:source.split('\n').length,rationale});
  for(const test of tests)cases.push({file,...test,category,action});
}
const sources=files.filter(f=>/\.(?:js|cjs|css|html|sh|yml)$/.test(f)&&!suiteFiles.includes(f)).map(file=>{
  const source=read(file);
  return {file,lines:source.split('\n').length,bytes:Buffer.byteLength(source),area:file.split('/')[0]};
});
const workflows=files.filter(f=>f.startsWith('.github/workflows/')).map(file=>({
  file,category:/deploy|release/.test(file)?'CRITICAL CONTRACT':'SCHEDULED/DEEP ONLY',
  action:'KEEP',rationale:/frontend/.test(file)?'Retain performance on ready PRs; focused public-share check substitutes only for this draft audit.':/sprite/.test(file)?'Upstream freshness is scheduled review, not automatic permission to import artwork.':'Pinned immutable release and rollback controls are not product-audit cleanup.'
}));
const scripts=files.filter(f=>/(^|\/)package\.json$/.test(f)).flatMap(file=>Object.entries(JSON.parse(read(file)).scripts||{}).map(([name,command])=>{
  const [category,action,rationale]=classify(name,command);
  return {file,name,command,category,action,rationale,explicitSuites:(command.match(/[\w./-]+\.(?:test\.cjs|spec\.js)/g)||[]).join(' ')};
}));
const checkTools=files.filter(f=>/(?:^|\/)(?:check-|validate-|audit-|review-).+\.(?:js|cjs|sh)$/.test(f)).map(file=>{
  const [category,action,rationale]=classify(file,read(file));return{file,category,action,rationale};
});
const counts=field=>suites.reduce((acc,row)=>(acc[row[field]]=(acc[row[field]]||0)+1,acc),{});
fs.writeFileSync(path.join(out,'test-suites.csv'),csv(suites,['file','category','action','declarations','lines','rationale']));
fs.writeFileSync(path.join(out,'test-declarations.csv'),csv(cases,['file','line','title','category','action']));
fs.writeFileSync(path.join(out,'source-inventory.csv'),csv(sources,['file','lines','bytes','area']));
fs.writeFileSync(path.join(out,'workflows.csv'),csv(workflows,['file','category','action','rationale']));
fs.writeFileSync(path.join(out,'package-commands.csv'),csv(scripts,['file','name','command','category','action','rationale','explicitSuites']));
fs.writeFileSync(path.join(out,'validation-entrypoints.csv'),csv(checkTools,['file','category','action','rationale']));
const summary={baseline:'794f8dbe08ee30a7de29ca73013b5ad77070ad44',trackedFiles:files.length,suites:suites.length,declarations:cases.length,
  note:'Declarations are parsed source sites, not executed test cases; loops may expand them. Classifications are suite-primary and recommendations, not deletion authorization.',
  byCategory:counts('category'),byAction:counts('action'),workflows:workflows.length,packageCommands:scripts.length,validationEntrypoints:checkTools.length,
  largestSources:[...sources].sort((a,b)=>b.lines-a.lines).slice(0,12)};
fs.writeFileSync(path.join(out,'inventory-summary.json'),JSON.stringify(summary,null,2)+'\n');
const application=inspect('js/app/application.js');
fs.writeFileSync(path.join(out,'application-functions.json'),JSON.stringify(application.functions,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
