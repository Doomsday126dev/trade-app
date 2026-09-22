const {defineConfig,devices}=require('@playwright/test');
const base=require('./playwright.config.js');
module.exports=defineConfig(base,{
  testMatch:'saving-favorites-emulator.spec.js',
  use:{baseURL:'http://localhost:4187'},
  webServer:{command:'python3 -m http.server 4187',url:'http://localhost:4187',cwd:process.env.INCIDENT_SOURCE_ROOT||__dirname,reuseExistingServer:false},
  projects:[...base.projects,{name:'webkit',use:{...devices['iPhone 13'],browserName:'webkit'}}]
});
