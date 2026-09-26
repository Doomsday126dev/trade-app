const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
const YAML=require('yaml');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('product evidence keeps job permissions, whole selector, failure status and always-upload boundaries',()=>{
  const workflow=YAML.parse(read('.github/workflows/product-review.yml'));
  assert.deepEqual(workflow.permissions,{contents:'read',actions:'read'});
  assert.deepEqual(Object.keys(workflow.jobs),['public-share']);
  assert.deepEqual(workflow.on.pull_request.types,['opened','synchronize','reopened','ready_for_review']);
  const steps=workflow.jobs['public-share'].steps;
  assert.ok(!steps.some(step=>step['continue-on-error']));
  const scrub=steps.find(step=>step.id==='evidence');assert.equal(scrub.if,'always()');
  const upload=steps.find(step=>step.uses?.startsWith('actions/upload-artifact@'));
  assert.match(upload.uses,/@[a-f0-9]{40}$/);assert.equal(upload.if,"always() && steps.evidence.outcome == 'success'");
  assert.equal(upload.with.path,'product-ci-artifacts/\ntest-results/\n');
  assert.equal(upload.with['if-no-files-found'],'error');assert.equal(upload.with['retention-days'],30);
  assert.equal(upload.with.name,'product-contracts-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.ok(!upload.with.overwrite&&!upload.with['include-hidden-files']);
});

test('stage wrapper preserves a failing process exit and does not retry it',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'product-evidence-'));
  try{
    execFileSync('git',['init'],{cwd:temp,stdio:'ignore'});
    execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture'],{cwd:temp,stdio:'ignore'});
    const code=`const {run}=require(${JSON.stringify(path.join(root,'scripts/ci/product-evidence.cjs'))});run('browser',{cwd:${JSON.stringify(temp)},env:{PATH:process.env.PATH},command:process.execPath,args:['-e',"console.log('one execution');process.exit(7)"]}).then(code=>process.exitCode=code);`;
    const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8'});
    assert.equal(result.status,7,result.stderr);assert.equal(result.stdout.trim(),'one execution');
    const status=JSON.parse(fs.readFileSync(path.join(temp,'product-ci-artifacts/browser-status.json')));
    assert.equal(status.code,7);assert.equal(status.signal,null);assert.ok(status.finished);
    const signal=spawnSync(process.execPath,['-e',code.replace("console.log('one execution');process.exit(7)","process.kill(process.pid,'SIGTERM')")],{encoding:'utf8'});
    assert.equal(signal.status,143,signal.stderr);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('sanitizer redacts log/report and trace text, preserves binary evidence and reports absent traces',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'product-sanitize-'));
  try{
    const dir=path.join(temp,'product-ci-artifacts');fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir,'node.log'),'fixture-secret-value Bearer fakeToken\n');
    execFileSync('python3',[path.join(root,'scripts/ci/sanitize-product-evidence.py')],{cwd:temp,env:{...process.env,GH_TOKEN:'fixture-secret-value'}});
    assert.equal(fs.readFileSync(path.join(dir,'node.log'),'utf8'),'[REDACTED] Bearer [REDACTED]\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'evidence-inventory.json'))).traceCount,0);
    const py="import zipfile, pathlib; p=pathlib.Path('test-results/case'); p.mkdir(parents=True); z=zipfile.ZipFile(p/'trace.zip','w'); z.writestr('test.trace','fixture-secret-value'); z.writestr('resources/image.png',bytes([255,0,254])); z.close()";
    execFileSync('python3',['-c',py],{cwd:temp});
    execFileSync('python3',[path.join(root,'scripts/ci/sanitize-product-evidence.py')],{cwd:temp,env:{...process.env,GH_TOKEN:'fixture-secret-value'}});
    const verify="import zipfile; z=zipfile.ZipFile('test-results/case/trace.zip'); assert z.read('test.trace')==b'[REDACTED]'; assert z.read('resources/image.png')==bytes([255,0,254])";
    execFileSync('python3',['-c',verify],{cwd:temp});
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'evidence-inventory.json'))).traceCount,1);
    fs.symlinkSync(root,path.join(dir,'unsafe-link'));
    assert.notEqual(spawnSync('python3',[path.join(root,'scripts/ci/sanitize-product-evidence.py')],{cwd:temp}).status,0);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('evidence reporter is opt-in and does not change test retry, trace or viewport contracts',()=>{
  const config=require('../playwright.config.js');
  assert.equal(config.retries??0,0);assert.equal(config.fullyParallel,false);
  assert.equal(config.use.trace,'retain-on-failure');assert.equal(config.use.screenshot,'only-on-failure');
  assert.deepEqual(config.projects.map(project=>project.name),['desktop','mobile']);
  assert.deepEqual(config.projects[0].use.viewport,{width:1440,height:900});
  const child=spawnSync(process.execPath,['-e',"console.log(JSON.stringify(require('./playwright.config.js').reporter))"],{cwd:root,env:{...process.env,PRODUCT_CI_EVIDENCE:'1'},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.deepEqual(JSON.parse(child.stdout),[['list'],['json',{outputFile:'product-ci-artifacts/browser-results.json'}]]);
});
