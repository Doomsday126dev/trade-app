#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const root=path.join(__dirname,'..');
const sourcePath=path.join(root,'tests/firebase/database.rules.sec02-production.json');
const targetPath=path.join(root,'tests/firebase/database.rules.legacy-provisioning-freeze.json');
const contractPath=path.join(root,'functions/production/legacy-provisioning-contract.json');
const check=process.argv.includes('--check');
const rules=structuredClone(JSON.parse(fs.readFileSync(sourcePath,'utf8')));
const isAdmin="auth != null && root.child('admins').child(auth.uid).val() === true";
const f="root.child('legacyProvisioningFreeze')";
const released=`(${f}.child('schemaVersion').val() === 1 || ${f}.child('schemaVersion').val() === 2) && ${f}.child('state').val() === 'released' && ${f}.child('provisioningModel').val() === 'bounded-legacy-provisioning-freeze' && ${f}.child('releasedAt').isNumber()`;
const expired=`${f}.child('schemaVersion').val() === 2 && ${f}.child('state').val() === 'active' && ${f}.child('provisioningModel').val() === 'bounded-legacy-provisioning-freeze' && ${f}.child('activatedAt').isNumber() && ${f}.child('activatedAt').val() > 0 && ${f}.child('expiresAt').isNumber() && ${f}.child('expiresAt').val() === ${f}.child('activatedAt').val() + 2100000 && now >= ${f}.child('expiresAt').val()`;
const creationOpen=`(!${f}.exists() || (${released}) || (${expired}))`;
const existingOnly="data.exists() && newData.exists()";
const sameAuthUid="newData.child('authUid').val() === data.child('authUid').val()";

rules.rules.legacyProvisioningFreeze={
  '.read':isAdmin,
  '.write':false
};
rules.rules.loginDirectory.$username['.write']=`${isAdmin} && (${creationOpen} || (${existingOnly}))`;
rules.rules.users.$username['.write']=`(${creationOpen} || ((${existingOnly}) && ${sameAuthUid})) && ${rules.rules.users.$username['.write']}`;
rules.rules.requests.$id['.write']=`(${rules.rules.requests.$id['.write']}) && (${creationOpen} || !newData.exists() || newData.child('status').val() !== 'approved')`;
rules.rules.authIndex.$uid['.write']=`(${creationOpen} || (${existingOnly}) || (!data.exists() && newData.exists() && root.child('users').child(newData.child('username').val()).child('authUid').val() === $uid)) && ${rules.rules.authIndex.$uid['.write']}`;

const rendered=`${JSON.stringify(rules,null,2)}\n`;
const policy={
  schemaVersion:1,
  provisioningModel:'bounded-legacy-provisioning-freeze',
  clientPolicyVersion:2,
  freezeSchemaVersion:2,
  immutableHardExpiryMs:2100000,
  candidateRulesSha256:crypto.createHash('sha256').update(rendered).digest('hex'),
  guardedPaths:['users/{username}','loginDirectory/{username}','requests/{requestId}:approved','authIndex/{uid}'],
  activePolicy:{newHandleCreate:false,existingRecordUpdate:true,existingRecordDelete:false,requestApproval:false,identityPreservingAuthIndex:true},
  releaseProtocol:['invalidate-provider-certification','publish-released-freeze-record','legacy-creation-may-resume']
};
const provisioningContractDigest=crypto.createHash('sha256').update(JSON.stringify(policy)).digest('hex');
const contract=`${JSON.stringify({...policy,provisioningContractDigest},null,2)}\n`;

if(check){
  if(!fs.existsSync(targetPath)||fs.readFileSync(targetPath,'utf8')!==rendered)throw new Error('Legacy provisioning candidate Rules are stale');
  if(!fs.existsSync(contractPath)||fs.readFileSync(contractPath,'utf8')!==contract)throw new Error('Legacy provisioning contract digest is stale');
  console.log(`legacy provisioning contract ${provisioningContractDigest} verified`);
}else{
  fs.writeFileSync(targetPath,rendered);
  fs.writeFileSync(contractPath,contract);
  console.log(`wrote legacy provisioning candidate Rules and contract ${provisioningContractDigest}`);
}
