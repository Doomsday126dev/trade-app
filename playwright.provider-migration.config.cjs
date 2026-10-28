const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests',testMatch:'provider-migration-preview.spec.js',timeout:30000,fullyParallel:false,
  use:{baseURL:'http://127.0.0.1:8886',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'python3 -m http.server 8886 --bind 127.0.0.1',url:'http://127.0.0.1:8886',reuseExistingServer:false},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],channel:'chromium'}},{name:'mobile',use:{...devices['Pixel 5'],channel:'chromium'}}]
});
