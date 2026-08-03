const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const repoRoot=path.resolve(__dirname,'../..');
const privateRoot=path.join(repoRoot,'.local/uid-handle-audits');
function resolveOutput(requested){
  const output=path.resolve(repoRoot,requested||path.join(privateRoot,'reports',`uid-handle-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`));
  const relative=path.relative(privateRoot,output);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Identity reports must stay under .local/uid-handle-audits'),{code:'report_path_outside_private_root'});
  return output;
}
function privateId(secret,internalKey){return`record-${crypto.createHmac('sha256',secret).update(internalKey).digest('hex').slice(0,20)}`;}
function buildPrivateReport(reconciliation,metadata,{generatedAt=new Date().toISOString(),secret=crypto.randomBytes(32)}={}){
  return{
    schemaVersion:1,
    toolVersion:'uid-handle-dry-run-v1',
    generatedAt,
    source:{kind:metadata.source,targetVerified:metadata.targetVerified,counts:metadata.sourceCounts,snapshotHashes:metadata.sourceSnapshotHashes},
    normalizationContract:reconciliation.normalizationContract,
    staleWarning:reconciliation.staleWarning,
    summary:{totalRecords:reconciliation.totalRecords,classificationCounts:reconciliation.classificationCounts},
    records:reconciliation.records.map(({internalKey,...record})=>({...record,recordId:privateId(secret,internalKey),seedEligible:false}))
  };
}
function writePrivateReport(report,requested){
  const output=resolveOutput(requested);
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});
  const actualRoot=fs.realpathSync(privateRoot);
  const actualParent=fs.realpathSync(path.dirname(output));
  const actualRelative=path.relative(actualRoot,actualParent);
  if(actualRelative.startsWith('..')||path.isAbsolute(actualRelative))throw Object.assign(new Error('Identity report parent resolves outside .local/uid-handle-audits'),{code:'report_path_outside_private_root'});
  fs.chmodSync(path.dirname(output),0o700);
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0);
  const fd=fs.openSync(output,flags,0o600);
  try{fs.writeFileSync(fd,`${JSON.stringify(report,null,2)}\n`);}finally{fs.closeSync(fd);}
  fs.chmodSync(output,0o600);
  return output;
}
function aggregateLines(report){
  const counts=report.summary.classificationCounts;
  return[
    `UID/handle dry-run source: ${report.source.kind}`,
    `Target verified: ${report.source.targetVerified?'yes':'not applicable'}`,
    `Total reconciliation records: ${report.summary.totalRecords}`,
    ...Object.keys(counts).sort().map(key=>`${key}: ${counts[key]}`),
    'Private detailed report written under .local/uid-handle-audits/.',
    'Warning: this result is immediately stale when any source changes.'
  ];
}
module.exports={privateRoot,resolveOutput,privateId,buildPrivateReport,writePrivateReport,aggregateLines};
