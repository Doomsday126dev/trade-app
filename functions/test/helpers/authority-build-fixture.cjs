'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const policy=require('../../production/e1AuthorityBuildPolicy.cjs');
const keyPair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const nativeVerify=crypto.verify;
const BUILD_ID='123e4567-e89b-42d3-a456-426614174000';
const DIGEST=`sha256:${'b'.repeat(64)}`;
function gcloudBase64(value){return value.replace(/\+/g,'-').replace(/\//g,'_');}
function record(plan,config,archiveSha256){
 const time=new Date().toISOString();
 const source={storageSource:{bucket:'synthetic-build-source',object:'source.tgz',generation:'123'}};
 return {...structuredClone(config),id:BUILD_ID,projectId:plan.target.projectId,
  name:`projects/${plan.target.projectNumber}/locations/${plan.target.region}/builds/${BUILD_ID}`,
  status:'SUCCESS',createTime:time,startTime:time,finishTime:time,
  steps:config.steps.map(s=>({...structuredClone(s),status:'SUCCESS'})),source,
  sourceProvenance:{resolvedStorageSource:structuredClone(source.storageSource),fileHashes:{'gs://synthetic-build-source/source.tgz':{fileHash:[{type:'SHA256',value:Buffer.from(archiveSha256,'hex').toString('base64')}]}}},
  results:{images:[{name:config.images[0],digest:DIGEST}],buildStepImages:[policy.TOOLCHAIN.docker.split('@')[1]]}};
}
function artifact(plan,build,config){
 const image=`${plan.target.imageUri}@${build.results.images[0].digest}`;
 const statement={_type:'https://in-toto.io/Statement/v1',predicateType:'https://slsa.dev/provenance/v1',
  subject:[{name:`https://${plan.target.imageUri}`,digest:{sha256:build.results.images[0].digest.slice(7)}}],
  predicate:{buildDefinition:{buildType:'https://cloud.google.com/build/gcb-buildtypes/google-worker/v1',
   externalParameters:{buildConfig:Buffer.from(JSON.stringify({steps:config.steps,options:config.options})).toString('base64')},
   resolvedDependencies:[{uri:policy.TOOLCHAIN.docker,digest:{sha256:policy.TOOLCHAIN.docker.split('@sha256:')[1]}}]},
   runDetails:{builder:{id:'https://cloudbuild.googleapis.com/GoogleHostedWorker'},metadata:{
    invocationId:`https://cloudbuild.googleapis.com/v1/projects/${plan.target.projectId}/locations/${plan.target.region}/builds/${build.id}`,
    startedOn:build.startTime,finishedOn:build.finishTime}}}};
 return {image_summary:{digest:build.results.images[0].digest,fully_qualified_digest:image},provenance_summary:{provenance:[{
  kind:'BUILD',resourceUri:`https://${image}`,build:{inTotoSlsaProvenanceV1:statement},envelope:sign(statement)}]}};
}
function sign(statement){
 const type='application/vnd.in-toto+json',payload=Buffer.from(JSON.stringify(statement));
 const message=Buffer.concat([Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${payload.length} `),payload]);
 return {payloadType:type,payload:payload.toString('base64'),signatures:[{keyid:policy.GOOGLE_PROVENANCE_KEY_ID,sig:crypto.sign('sha256',message,keyPair.privateKey).toString('base64')}]};
}
function mockGoogleSignature(mock){
 // Only the Google signing service is simulated. Payload bytes and ECDSA/DSSE
 // verification remain real, using a fresh synthetic test key. Production has
 // no key override and always uses its reviewed immutable Google public key.
 return mock.method(crypto,'verify',(algorithm,message,key,signature)=>{
  assert.equal(key,policy.GOOGLE_PROVENANCE_PUBLIC_KEY);
  return nativeVerify(algorithm,message,keyPair.publicKey,signature);
 });
}
function buildSpawn(plan,{mutateBuild=()=>{},mutateArtifact=()=>{}}={}){
 let build,config,archive;
 const calls=[];
 function spawn(command,args){
  calls.push([command,...args]);assert.equal(command,'gcloud');
  if(args[0]==='builds'&&args[1]==='submit'){
   const configPath=args.find(a=>a.startsWith('--config=')).slice(9);config=JSON.parse(fs.readFileSync(configPath));
   archive=fs.readFileSync(args[2]);build=record(plan,config,policy.sha256(archive));mutateBuild(build);
   return {status:0,stdout:JSON.stringify(build)};
  }
  if(args[0]==='builds'&&args[1]==='describe')return {status:0,stdout:JSON.stringify(build)};
  if(args[0]==='storage'&&args[1]==='cp'){fs.writeFileSync(args[3],archive);return {status:0,stdout:''};}
  if(args[0]==='artifacts'){
   const value=artifact(plan,build,config);mutateArtifact(value);return {status:0,stdout:JSON.stringify(value)};
  }
  throw new Error('unexpected synthetic command');
 }
 return {spawn,calls};
}
module.exports={record,artifact,sign,gcloudBase64,mockGoogleSignature,buildSpawn,BUILD_ID,DIGEST};
