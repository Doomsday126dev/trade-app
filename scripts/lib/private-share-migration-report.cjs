const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {privateRoot}=require('./private-identity-report.cjs');

function outputPath(requested){
  const value=path.resolve(requested||path.join(privateRoot,'reports',`share-migration-audit-${new Date().toISOString().replace(/[:.]/g,'-')}.json`));
  const relative=path.relative(privateRoot,value);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Share audit report must stay private'),{code:'report_path_outside_private_root'});
  return value;
}
function recordId(secret,key){return`share-${crypto.createHmac('sha256',secret).update(key).digest('hex').slice(0,20)}`;}
function buildReport(audit,metadata,{generatedAt=new Date().toISOString(),secret=crypto.randomBytes(32)}={}){
  return{schemaVersion:1,toolVersion:audit.toolVersion,generatedAt,source:{kind:metadata.source,targetVerified:metadata.targetVerified,
    counts:metadata.sourceCounts,snapshotHashes:metadata.sourceSnapshotHashes,requestCount:metadata.requestCount},normalizationContract:audit.normalizationContract,
    staleWarning:audit.staleWarning,summary:{totalRecords:audit.totalRecords,classificationCounts:audit.classificationCounts,reasonCodeCounts:audit.reasonCodeCounts},
    records:audit.records.map(({internalKey,...record})=>({...record,recordId:recordId(secret,internalKey),seedEligible:false}))};
}
function writeReport(report,requested){
  const output=outputPath(requested);fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  const rootReal=fs.realpathSync(privateRoot),parentReal=fs.realpathSync(path.dirname(output)),relative=path.relative(rootReal,parentReal);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Share audit report parent escaped private root'),{code:'report_path_outside_private_root'});
  const fd=fs.openSync(output,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0),0o600);
  try{fs.writeFileSync(fd,`${JSON.stringify(report,null,2)}\n`);}finally{fs.closeSync(fd);}fs.chmodSync(output,0o600);return output;
}
function aggregateLines(report){return[
  'Share migration audit source: production',
  `Total records: ${report.summary.totalRecords}`,
  ...Object.entries(report.summary.classificationCounts).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}: ${value}`),
  ...Object.entries(report.summary.reasonCodeCounts).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`reason.${key}: ${value}`),
  `Exact public-share reads: ${report.source.counts.exactPublicShareReads}`,
  'Private report written under .local/uid-handle-audits/.',
  'Writes: 0'
];}
module.exports={outputPath,recordId,buildReport,writeReport,aggregateLines};
