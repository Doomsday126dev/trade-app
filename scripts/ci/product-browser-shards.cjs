'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {select,changedFiles,reviewBase}=require('../select-product-checks.cjs');
const PLAN_DIR='product-browser-plan',RESULT_DIR='product-ci-artifacts',SHARDS=4;
const equal=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
function fail(message){throw new Error(message);}
function reportCases(report,cwd=process.cwd()){
 if(!Array.isArray(report.suites)||report.errors?.length)fail('Browser discovery/report is incomplete');
 const rows=[];
 function visit(suite,titles=[]){
  const nested=suite.column===0&&suite.line===0?titles:[...titles,suite.title].filter(Boolean);
  for(const spec of suite.specs||[])for(const test of spec.tests||[]){
   const project=test.projectName;if(project!=='desktop')fail('Unexpected browser project');
   const file=path.relative(cwd,path.resolve(report.config.rootDir,spec.file)).split(path.sep).join('/');
   if(!/^tests\/.+\.spec\.js$/.test(file))fail('Unsafe/unknown browser spec path');
   const title=[...nested,spec.title].join(' › '),id=`[${project}] › ${file} › ${title}`;
   if(/[\r\n]/.test(id))fail('Multiline case identity requires explicit review');
   rows.push({id,file,title,status:test.status,expectedStatus:test.expectedStatus,results:test.results||[]});
  }
  for(const child of suite.suites||[])visit(child,nested);
 }
 for(const suite of report.suites)visit(suite);
 if(new Set(rows.map(r=>r.id)).size!==rows.length)fail('Duplicate browser case identity');
 return rows;
}
function discover(files,{cwd=process.cwd(),listFile}={}){
 if(!files.length)return[];
 const args=['node_modules/@playwright/test/cli.js','test',...files,'--project=desktop','--list','--reporter=json',...(listFile?['--test-list',listFile]:[])];
 const text=cp.execFileSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});
 const rows=reportCases(JSON.parse(text),cwd);if(!rows.length)fail('Nonempty browser selection discovered zero cases');return rows;
}
function digest(plan){const{planDigest,...body}=plan;return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');}
function makePlan(cases,{sourceSha,base,files,timings,shardCount=SHARDS}={}){
 if(!/^[a-f0-9]{40}$/.test(sourceSha||'')||!Array.isArray(files)||shardCount!==SHARDS)fail('Invalid shard provenance');
 const observed=timings?.records||{},family=new Map();for(const [key,r]of Object.entries(observed)){if(!Number.isFinite(r.seconds)||r.seconds<=0)fail('Invalid measured duration');const file=key.split(' › ')[0];if(!family.has(file))family.set(file,[]);family.get(file).push(r.seconds);}
 const estimate=r=>{const exact=observed[r.file+' › '+r.title]?.seconds;if(exact)return Math.max(1,exact);const samples=family.get(r.file);if(samples?.length)return Math.max(1,[...samples].sort((a,b)=>a-b)[Math.floor(samples.length/2)]);return timings?.defaultSeconds||12;};
 const rows=cases.map(r=>({id:r.id,file:r.file,title:r.title,estimatedSeconds:estimate(r)}));
 const shards=Array.from({length:SHARDS},(_,i)=>({index:i+1,estimatedSeconds:0,cases:[]}));
 for(const row of [...rows].sort((a,b)=>b.estimatedSeconds-a.estimatedSeconds||a.id.localeCompare(b.id,'en'))){const shard=[...shards].sort((a,b)=>a.estimatedSeconds-b.estimatedSeconds||a.index-b.index)[0];shard.cases.push(row.id);shard.estimatedSeconds+=row.estimatedSeconds;}
 for(const shard of shards){shard.cases.sort();shard.estimatedSeconds=Math.round(shard.estimatedSeconds*1000)/1000;}
 const plan={schemaVersion:1,sourceSha,base,files:[...files],cases:rows,shards};plan.planDigest=digest(plan);validatePlan(plan);return plan;
}
function testListLines(plan,shard){
 const byId=new Map(plan.cases.map(r=>[r.id,r]));
 return shard.cases.map(id=>{const r=byId.get(id);if(!r||!r.file.startsWith('tests/'))fail('Invalid native test-list identity');return `[desktop] › ${r.file.slice(6)} › ${r.title}`;});
}
function validatePlan(plan){
 if(plan.schemaVersion!==1||plan.planDigest!==digest(plan)||plan.shards?.length!==SHARDS)fail('Invalid/changed browser shard plan');
 const expected=plan.cases.map(r=>r.id),seen=[];if(new Set(expected).size!==expected.length)fail('Duplicate discovered browser case');
 if(!equal(plan.shards.map(s=>s.index),[1,2,3,4]))fail('Missing/duplicate shard index');
 for(const shard of plan.shards)seen.push(...shard.cases);
 if(new Set(seen).size!==seen.length||!equal(seen,expected))fail('Shard union has duplicate, omitted or unknown cases');
 return plan;
}
function validateResults(plan,results){
 validatePlan(plan);if(results.length!==(plan.cases.length?SHARDS:0))fail('Incomplete browser shard results');const all=[],indices=[];
 for(const result of results){if(result.sourceSha!==plan.sourceSha||result.planDigest!==plan.planDigest)fail('Stale browser shard result');indices.push(result.index);const shard=plan.shards.find(s=>s.index===result.index);if(!shard||result.code!==0||result.error)fail('Failed browser shard');
  if(!equal(result.cases.map(r=>r.id),shard.cases)||new Set(result.cases.map(r=>r.id)).size!==result.cases.length)fail('Shard execution omitted or duplicated cases');
  for(const row of result.cases){if(!['expected','skipped'].includes(row.status)||!Array.isArray(row.results)||row.results.length!==1||row.results.some(r=>r.retry!==0||!['passed','skipped'].includes(r.status)))fail('Unexpected/flaky/retried browser case');all.push(row.id);}
 }
 if(results.length&&!equal(indices,[1,2,3,4]))fail('Duplicate/missing completed browser shard');if(!equal(all,plan.cases.map(r=>r.id))||new Set(all).size!==all.length)fail('Executed browser union does not match discovery');return{discovered:plan.cases.length,executed:all.length,shards:results.length};
}
const gitSha=()=>cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
function filesNamed(dir,name){if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesNamed(path.join(dir,e.name),name):e.isFile()&&e.name===name?[path.join(dir,e.name)]:[]);}
function main(){
 const mode=process.argv[2];
 if(mode==='plan'){
  const base=reviewBase(process.env.PRODUCT_BASE_SHA);if(!/^[a-f0-9]{40}$/.test(base||''))fail('Exact comparison base required');const files=select(changedFiles(base)).browser,rows=discover(files),timings=JSON.parse(fs.readFileSync(path.join(__dirname,'product-browser-timings.json'))),plan=makePlan(rows,{sourceSha:gitSha(),base,files,timings});fs.mkdirSync(PLAN_DIR,{recursive:true});fs.writeFileSync(path.join(PLAN_DIR,'inventory.json'),JSON.stringify(plan,null,2)+'\n');for(const s of plan.shards)fs.writeFileSync(path.join(PLAN_DIR,`shard-${s.index}.txt`),testListLines(plan,s).join('\n')+'\n');console.log(JSON.stringify({source:plan.sourceSha,count:rows.length,shards:plan.shards.map(s=>({index:s.index,cases:s.cases.length,estimatedSeconds:s.estimatedSeconds}))}));
 }else if(mode==='run'){
  const index=Number(process.argv[3]),plan=validatePlan(JSON.parse(fs.readFileSync(path.join(PLAN_DIR,'inventory.json'))));if(plan.sourceSha!==gitSha())fail('Browser plan checkout mismatch');const shard=plan.shards.find(s=>s.index===index);if(!shard||!shard.cases.length)fail('Invalid/empty browser shard');const listFile=path.join(PLAN_DIR,`shard-${index}.txt`);if(!equal(fs.readFileSync(listFile,'utf8').trim().split('\n'),testListLines(plan,shard)))fail('Changed shard test list');const collected=discover(plan.files,{listFile});if(!equal(collected.map(r=>r.id),shard.cases))fail('Playwright test-list selection differs from planned cases');
  fs.mkdirSync(RESULT_DIR,{recursive:true});const args=['node_modules/@playwright/test/cli.js','test',...plan.files,'--project=desktop','--workers=1','--test-list',listFile];const execution=cp.spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,PRODUCT_CI_EVIDENCE:'1'}});let cases=[],error='';try{cases=reportCases(JSON.parse(fs.readFileSync(path.join(RESULT_DIR,'browser-results.json'))));}catch(e){error=e.message;}const result={schemaVersion:1,index,sourceSha:plan.sourceSha,planDigest:plan.planDigest,code:execution.status??1,error,cases};fs.writeFileSync(path.join(RESULT_DIR,'shard-result.json'),JSON.stringify(result,null,2)+'\n');if(error||!equal(cases.map(r=>r.id),shard.cases))fail('Incomplete browser shard execution evidence');process.exitCode=result.code;
 }else if(mode==='verify'){
  const plan=validatePlan(JSON.parse(fs.readFileSync(path.join(PLAN_DIR,'inventory.json'))));if(plan.sourceSha!==gitSha())fail('Aggregate checkout mismatch');if(process.env.NODE_RESULT&&process.env.NODE_RESULT!=='success')fail('Node contracts did not pass');if(process.env.BROWSER_RESULT&&process.env.BROWSER_RESULT!==(plan.cases.length?'success':'skipped'))fail('Browser matrix did not pass');if(!equal(discover(plan.files).map(r=>r.id),plan.cases.map(r=>r.id)))fail('Discovery differs at aggregate');const results=filesNamed(process.argv[3]||'product-browser-evidence','shard-result.json').map(f=>JSON.parse(fs.readFileSync(f)));console.log(JSON.stringify(validateResults(plan,results)));
 }else fail('Expected plan, run or verify');
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
module.exports={reportCases,makePlan,validatePlan,validateResults,discover,digest,testListLines};
