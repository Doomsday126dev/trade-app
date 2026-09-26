// Runs the existing selector once, retaining diagnostics without changing its result.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const stageArgs=stage=>{
  if(!['node','browser'].includes(stage))throw new Error('Expected node or browser stage');
  return ['scripts/select-product-checks.cjs',...(stage==='browser'?['--browser']:[])];
};
async function run(stage,{cwd=process.cwd(),env=process.env,command=process.execPath,args=stageArgs(stage)}={}){
  stageArgs(stage);
  const dir=path.join(cwd,'product-ci-artifacts');fs.mkdirSync(dir,{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
  const metadata={stage,started:new Date().toISOString(),node:process.version,platform:process.platform,
    os:os.release(),checkout:git('rev-parse','HEAD'),base:env.PRODUCT_BASE_SHA||null,
    workflowHeadRef:env.GITHUB_HEAD_REF||null,workflowCheckout:env.GITHUB_SHA||null,
    run:env.GITHUB_RUN_ID||null,attempt:env.GITHUB_RUN_ATTEMPT||null,
    playwright:require('@playwright/test/package.json').version,command,args};
  const record=()=>fs.writeFileSync(path.join(dir,`${stage}-status.json`),JSON.stringify(metadata,null,2)+'\n');
  record();
  const log=fs.createWriteStream(path.join(dir,`${stage}.log`));
  const child=spawn(command,args,{cwd,env:{...env,PRODUCT_CI_EVIDENCE:'1',
    // Process launch/exit/stderr only; never protocol/headers or an env dump.
    ...(stage==='browser'?{DEBUG:'pw:browser'}:{})}});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log.write(chunk);process.stdout.write(chunk);});
  const term=()=>child.kill('SIGTERM'),interrupt=()=>child.kill('SIGINT');
  process.on('SIGTERM',term);process.on('SIGINT',interrupt);
  child.on('error',error=>{metadata.spawnError=error.message;});
  return new Promise(resolve=>child.on('close',(code,signal)=>{
    process.removeListener('SIGTERM',term);process.removeListener('SIGINT',interrupt);
    metadata.finished=new Date().toISOString();metadata.code=code;metadata.signal=signal;record();
    log.end(()=>resolve(code??(signal?128+(os.constants.signals[signal]||0):1)));
  }));
}
if(require.main===module)run(process.argv[2]).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,stageArgs};
