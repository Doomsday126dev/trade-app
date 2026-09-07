const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const YAML=require('yaml');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const dispatcher=YAML.parse(read('.github/workflows/deploy-pages.yml'));
const pin=dispatcher.jobs.deploy.uses.split('@')[1];
const pinned=YAML.parse(execFileSync('git',['show',`${pin}:.github/workflows/pages-release-control.yml`],{cwd:root,encoding:'utf8'}));

test('dispatcher preserves exact immutable workflow and control input agreement',()=>{
  assert.match(pin,/^[a-f0-9]{40}$/);
  assert.equal(dispatcher.jobs.deploy.with.control_workflow_sha,pin);
  const steps=pinned.jobs['validate-build'].steps;
  assert.equal(steps.find(step=>step.with?.path==='target').with.ref,'${{ inputs.runtime_source_sha }}');
  assert.equal(steps.find(step=>step.with?.path==='control').with.ref,'${{ job.workflow_sha }}');
});

test('every Node test named by executing pinned control exists in its actual checkout',()=>{
  for(const job of Object.values(pinned.jobs))for(const step of job.steps||[]){
    for(const [,checkout,file]of (step.run||'').matchAll(/\b(target|control)\/(tests\/[^\s\\]+\.test\.cjs)/g)){
      if(checkout==='target')assert.ok(fs.existsSync(path.join(root,file)),`runtime missing ${file}`);
      else assert.doesNotThrow(()=>execFileSync('git',['cat-file','-e',`${pin}:${file}`],{cwd:root,stdio:'pipe'}),`pinned control missing ${file}`);
    }
  }
});

test('local release command retains permanent release coverage with existing files',()=>{
  const command=JSON.parse(read('package.json')).scripts['test:pages-release'];
  const files=command.match(/tests\/[^\s]+\.test\.cjs/g);
  assert.ok(files.includes('tests/service-worker-release.test.cjs'));
  for(const file of files)assert.ok(fs.existsSync(path.join(root,file)),file);
});

test('PR planning precedes dependency setup and executes the same changed-area selector',()=>{
  const steps=YAML.parse(read('.github/workflows/product-review.yml')).jobs['public-share'].steps;
  const plan=steps.findIndex(step=>step.run==='node scripts/select-product-checks.cjs --plan');
  const deps=steps.findIndex(step=>step.run==='npm ci --prefix functions --ignore-scripts');
  const run=steps.findIndex(step=>step.run==='node scripts/select-product-checks.cjs');
  assert.ok(plan>=0&&plan<deps&&deps<run);
  assert.match(steps[deps].if,/selection.outputs.functions == 'true'/);
  assert.equal(steps.find(step=>step.uses?.startsWith('actions/checkout@')).with['fetch-depth'],0);
});
