const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests',testMatch:'usability-improvements.spec.js',timeout:60000,
  expect:{timeout:10000},workers:1,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4196',serviceWorkers:'block',screenshot:'only-on-failure'},
  webServer:{command:'python3 -m http.server 4196',url:'http://127.0.0.1:4196',reuseExistingServer:false},
  projects:[
    {name:'chromium-desktop',use:{browserName:'chromium',viewport:{width:1440,height:900}}},
    {name:'chromium-phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
    {name:'webkit-phone',use:{browserName:'webkit',viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark'}},
    {name:'firefox-desktop',use:{browserName:'firefox',viewport:{width:1440,height:900}}}
  ]
});
