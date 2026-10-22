const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests',testMatch:'share-independent-corrections.spec.js',
  timeout:90000,expect:{timeout:10000},workers:1,
  use:{baseURL:process.env.PLAYWRIGHT_BASE_URL||'http://localhost:4174',viewport:{width:1440,height:900},serviceWorkers:'block',trace:'retain-on-failure'},
  webServer:process.env.PLAYWRIGHT_BASE_URL?undefined:{command:'python3 -m http.server 4174 --bind 127.0.0.1',url:'http://localhost:4174',reuseExistingServer:!process.env.CI},
  projects:['chromium','firefox','webkit'].map(browserName=>({name:browserName,use:{browserName}}))
});
