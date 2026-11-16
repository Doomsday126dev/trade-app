const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests',testMatch:'input-focus.spec.js',timeout:90000,workers:1,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4521',serviceWorkers:'block',screenshot:'only-on-failure'},
  webServer:{command:'python3 -m http.server 4521 --bind 127.0.0.1',url:'http://127.0.0.1:4521',reuseExistingServer:false},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'webkit',use:{...devices['Desktop Safari']}},{name:'webkit-mobile',use:{...devices['iPhone 13']}}]
});
