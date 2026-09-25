const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests',testMatch:['share-application.spec.js','share-export-content.spec.js','share-hardening.spec.js'],
  timeout:90000,expect:{timeout:10000},workers:1,
  reporter:[['list']],
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:4198',viewport:{width:1440,height:900},serviceWorkers:'block',trace:'retain-on-failure'},
  projects:['chromium','firefox','webkit'].map(browserName=>({name:browserName,use:{browserName}}))
});
