const {defineConfig,devices}=require('@playwright/test');
const base=require('./playwright.config.js');
module.exports=defineConfig({...base,
  testMatch:['normal-sync-product.spec.js','reliability-pwa-shell.spec.js'],
  use:{...base.use,baseURL:'http://localhost:4189'},
  webServer:{command:'python3 -m http.server 4189',url:'http://localhost:4189',cwd:__dirname,reuseExistingServer:false},
  workers:1,
  projects:[
    {name:'reliability-chromium',use:{...devices['Desktop Chrome']}},
    {name:'reliability-webkit',use:{...devices['Desktop Safari']}},
    {name:'reliability-iphone',use:{...devices['iPhone 13'],browserName:'webkit'}}
  ]
});
