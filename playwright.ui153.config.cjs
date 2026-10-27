const {defineConfig}=require('@playwright/test'),fs=require('node:fs');
const {buildArtifact}=require('./scripts/pages/build-artifact.cjs'),{validateReleaseCoherence}=require('./scripts/pages/validate-release.cjs');
const release=validateReleaseCoherence(__dirname),out=fs.mkdtempSync('/tmp/trade153-packaged-');
// Synthetic packaging fixture; never a release artifact or production provenance.
buildArtifact({source:__dirname,output:out,runtimeSourceSha:'0'.repeat(40),runtimeReleaseId:release.releaseId,runtimeReleaseTag:'release-'+release.releaseId,dispatcherSha:'2'.repeat(40),controlSelectorTag:'release-pages-control-'+'2'.repeat(40),controlWorkflowSha:'1'.repeat(40),githubRunId:'0'});
module.exports=defineConfig({testDir:'./tests',testMatch:'ui153-refinements.spec.js',timeout:60000,workers:1,reporter:'list',outputDir:'/tmp/trade153-qa/results',use:{baseURL:'http://127.0.0.1:4353',serviceWorkers:'block',trace:'retain-on-failure'},webServer:{command:"python3 -m http.server 4353 --bind 127.0.0.1 --directory '"+out+"'",url:'http://127.0.0.1:4353',reuseExistingServer:false},projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}]});
