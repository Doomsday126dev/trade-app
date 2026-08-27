const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const html=require('../scripts/lib/frontend-source.cjs').readFrontendSource(root);
const locale=readFileSync(path.join(root,'js/i18n/locales/en.js'),'utf8');
const securityDoc=readFileSync(path.join(root,'SECURITY-RULES.md'),'utf8');
const candidatePath='tests/firebase/database.rules.narrow-read.json';
const candidateSha='e0632a98ed106117f03e61da0446ef4b2c2e6ed02ea8c6f1c498a0e7edcb17bf';
const obsoleteRead='"'+'.read'+'": "auth != null"';

function securityPanelSource(){
  const start=html.indexOf('function renderSecurityPanel()');
  const end=html.indexOf('\nfunction loginAuditRows()',start);
  assert.ok(start>=0&&end>start,'renderSecurityPanel must remain inspectable');
  return html.slice(start,end);
}

test('Admin Security panel contains reviewed deployment metadata only',()=>{
  const panel=securityPanelSource();
  const actualSha=createHash('sha256').update(readFileSync(path.join(root,candidatePath))).digest('hex');
  assert.equal(actualSha,candidateSha);
  assert.match(html,new RegExp(`candidateSha256:'${candidateSha}'`));
  assert.match(html,new RegExp(`reviewedCandidatePath:'${candidatePath.replaceAll('.','\\.')}'`));
  assert.match(html,/deployedAt:'2026-08-05 10:05:15 EDT'/);
  assert.match(html,/rollbackReady:true/);
  assert.doesNotMatch(panel,/SECURE_RULES|secure-rules-text|Copy secure Firebase rules/i);
  assert.doesNotMatch(panel,/textarea|"rules"\s*:/i);
  assert.doesNotMatch(html,/const\s+\w*RULES\w*\s*=\s*`?\s*\{\s*"rules"/s);
});

test('Admin copy actions expose only the reviewed SHA and candidate path',()=>{
  const panel=securityPanelSource();
  const copies=[...panel.matchAll(/data-copy="\$\{escAttr\(([^)]+)\)\}"/g)].map(match=>match[1]);
  assert.deepEqual(copies,['meta.candidateSha256','meta.reviewedCandidatePath']);
  assert.doesNotMatch(panel,/browser state.*generate|generate.*rules|copy.*rules/i);
  assert.match(locale,/'admin\.securityArtifactWarning':'Manage production rules only from reviewed repository artifacts\. Browser state is not a rules source\.'/);
});

test('Admin Security panel renders status without a raw rules control',()=>{
  const panel={innerHTML:''};
  const messages={
    'admin.securityTitle':'Firebase security',
    'admin.securityDeployed':'Narrow-read rules deployed',
    'admin.securityDeploymentTime':'Deployment time',
    'admin.securityCandidateSha':'Candidate SHA-256',
    'admin.securityReviewedArtifact':'Reviewed artifact',
    'admin.securityRollbackReady':'Rollback readiness',
    'admin.securityRollbackReadyValue':'Rollback ready',
    'admin.securityRollbackUnavailableValue':'Rollback unavailable',
    'admin.securityArtifactWarning':'Repository artifacts only',
    'admin.securityCopySha':'Copy SHA',
    'admin.securityCopyPath':'Copy path'
  };
  const context=vm.createContext({
    document:{getElementById:id=>id==='security-panel'?panel:null},
    i18nCore:{t:key=>messages[key]||key},
    escHtml:String,
    escAttr:String
  });
  const metadata=html.match(/const FIREBASE_RULES_STATUS=Object\.freeze\(\{[\s\S]*?\}\);/)?.[0];
  assert.ok(metadata);
  vm.runInContext(`${metadata}\n${securityPanelSource()}\nrenderSecurityPanel();`,context);
  assert.match(panel.innerHTML,/Narrow-read rules deployed/);
  assert.match(panel.innerHTML,new RegExp(candidateSha));
  assert.match(panel.innerHTML,new RegExp(candidatePath.replaceAll('.','\\.')));
  assert.doesNotMatch(panel.innerHTML,/textarea|secure rules|"rules"\s*:/i);
});

test('tracked broad-read strings are confined to explicit historical or emulator artifacts',()=>{
  const allowed=new Set([
    'docs/NARROW-READ-RULES-PLAN.md',
    'docs/PILOT-MONITORING.md',
    'docs/PILOT-ROLLOUT.md',
    'tests/firebase/database.rules.current.json',
    'tests/firebase/database.rules.global-identity.json',
    'tests/firebase/database.rules.hardened.json',
    'tests/firebase/database.rules.share-visibility.json'
  ]);
  const tracked=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const containing=tracked.filter(file=>readFileSync(path.join(root,file),'utf8').includes(obsoleteRead));
  assert.deepEqual(containing.sort(),[...allowed].sort());
  assert.match(readFileSync(path.join(root,'docs/PILOT-MONITORING.md'),'utf8'),/ARCHIVED HISTORICAL RUNBOOK/);
  assert.match(readFileSync(path.join(root,'docs/PILOT-ROLLOUT.md'),'utf8'),/ARCHIVED HISTORICAL RUNBOOK/);
  assert.doesNotMatch(html,new RegExp(obsoleteRead.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(securityDoc,new RegExp(obsoleteRead.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('repository guidance names the reviewed fixture as the rules source of truth',()=>{
  assert.match(securityDoc,new RegExp(`Reviewed artifact \| \`${candidatePath.replaceAll('.','\\.')}\``));
  assert.match(securityDoc,new RegExp(candidateSha));
  assert.match(securityDoc,/does not embed copyable production rules JSON/);
  assert.match(securityDoc,/Never merge fragments or generate rules from browser\s+state/);
  assert.doesNotMatch(securityDoc,/Canonical ruleset|canonical block above/i);
});
