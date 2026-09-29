const base=require('./playwright.config.js');
const {devices}=require('@playwright/test');

module.exports={...base,projects:[
  {name:'release-chromium',use:{...devices['Desktop Chrome'],channel:'chromium',viewport:{width:390,height:700}}},
  {name:'release-firefox',use:{...devices['Desktop Firefox'],viewport:{width:390,height:700}}},
  {name:'release-webkit',use:{...devices['Desktop Safari'],viewport:{width:390,height:700}}}
]};
