const fs=require('fs');
const path=require('path');
const {privateRoot}=require('./identity-review-source-reader.cjs');

function resolveReviewOutput(requested){
  const output=path.resolve(requested||path.join(privateRoot,'reviews',`identity-review-${new Date().toISOString().replace(/[:.]/g,'-')}.json`));
  const relative=path.relative(privateRoot,output);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Identity review artifacts must stay under .local/uid-handle-audits'),{code:'review_output_outside_private_root'});
  return output;
}

function buildPrivateReviewArtifact(diagnostics,metadata,{generatedAt=new Date().toISOString()}={}){
  return{
    schemaVersion:1,
    toolVersion:'identity-conflict-review-v1',
    generatedAt,
    sourceReport:{
      sha256:metadata.sourceReportHash,
      expectedSnapshotHashes:{...metadata.expectedSnapshotHashes},
      actualSnapshotHashes:{...metadata.actualSnapshotHashes}
    },
    freshness:{
      stale:diagnostics.freshness.stale,
      mismatchedSources:[...diagnostics.freshness.mismatchedSources],
      warning:diagnostics.freshness.stale
        ?'Source hashes differ from the reconciliation report. Do not use this artifact for decisions.'
        :'This artifact becomes stale as soon as any identity source changes.'
    },
    constraints:{
      executable:false,
      createsOwnershipDecision:false,
      seedEligible:false,
      ignoredAuthoritySignals:[...diagnostics.ignoredAuthoritySignals]
    },
    summary:{
      totalRecords:diagnostics.records.length,
      dispositionCounts:{...diagnostics.dispositionCounts}
    },
    records:diagnostics.records.map(record=>({...record,reviewDecision:'unreviewed',seedEligible:false}))
  };
}

function writePrivateReviewArtifact(artifact,requested){
  const output=resolveReviewOutput(requested);
  fs.mkdirSync(privateRoot,{recursive:true,mode:0o700});
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
  const actualRoot=fs.realpathSync(privateRoot);
  const actualParent=fs.realpathSync(path.dirname(output));
  const relative=path.relative(actualRoot,actualParent);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Object.assign(new Error('Identity review parent resolves outside the private root'),{code:'review_output_outside_private_root'});
  fs.chmodSync(path.dirname(output),0o700);
  const flags=fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|(fs.constants.O_NOFOLLOW||0);
  const fd=fs.openSync(output,flags,0o600);
  try{fs.writeFileSync(fd,`${JSON.stringify(artifact,null,2)}\n`);}finally{fs.closeSync(fd);}
  fs.chmodSync(output,0o600);
  return output;
}

function reviewAggregateLines(artifact){
  return[
    `Identity review records: ${artifact.summary.totalRecords}`,
    ...Object.keys(artifact.summary.dispositionCounts).sort().map(key=>`${key}: ${artifact.summary.dispositionCounts[key]}`),
    `Source hashes stale: ${artifact.freshness.stale?'yes':'no'}`,
    `Mismatched source count: ${artifact.freshness.mismatchedSources.length}`,
    'Private review artifact written under .local/uid-handle-audits/.'
  ];
}

module.exports={resolveReviewOutput,buildPrivateReviewArtifact,writePrivateReviewArtifact,reviewAggregateLines};
