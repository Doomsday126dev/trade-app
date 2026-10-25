const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {expect}=require('@playwright/test');
const root=join(__dirname,'../..');
const source=readFileSync(join(root,'tests/trusted-readiness.spec.js'),'utf8').replaceAll('Mazer','ReviewTrainerA').replaceAll('RecentTrainer','ReviewTrainerB');
const loadFullApp=eval('('+source.slice(source.indexOf('async function loadFullApp('),source.indexOf('\nasync function installTrustedFixture'))+')');
const installTrustedFixture=eval('('+source.slice(source.indexOf('async function installTrustedFixture('),source.indexOf('\nasync function expectNoOverflow'))+')');
const identity={uid:'audit-owner-uid',username:'AuditOwner'};
const transport=readFileSync(join(root,'tests/signed-in-boot-dependencies.spec.js'),'utf8');
const installLoginTransport=eval('('+transport.slice(transport.indexOf('async function installLoginTransport('),transport.indexOf('\nasync function assertReducedRuntime'))+')');
async function fixture(page){
  const origin=new URL(page.context()._options.baseURL).origin;
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  await installLoginTransport(page);await page.goto('/?isolated-usability');await installTrustedFixture(page);
  await page.evaluate(()=>{currentAuthUid=auth.currentUser.uid;navigator.clipboard.writeText=async value=>{window.__copiedText=value;};window.confirm=()=>true;});
}
const normal=readFileSync(join(root,'tests/normal-sync-product.spec.js'),'utf8');
const installNormal=eval('('+normal.slice(normal.indexOf('async function install('),normal.indexOf('\nasync function settled'))+')');
const settled=eval('('+normal.slice(normal.indexOf('async function settled('),normal.indexOf('\ntest('))+')');
async function normalFixture(page){
  const origin=new URL(page.context()._options.baseURL).origin;
  await page.context().route('**/*',route=>new URL(route.request().url()).origin===origin&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort());
  await installLoginTransport(page);await installNormal(page);await settled(page);
}
module.exports={fixture,normalFixture,settled,loadFullApp,installLoginTransport};
