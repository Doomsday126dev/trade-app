const {defineConfig,devices}=require('@playwright/test');

module.exports=defineConfig({
  testDir:'./tests',
  testMatch:['cross-browser-accessibility.spec.js','batch-b-product.spec.js','launch-readiness-fixes.spec.js'],
  timeout:60_000,
  expect:{timeout:10_000},
  fullyParallel:false,
  workers:1,
  reporter:[['list']],
  use:{baseURL:'http://localhost:4174',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[
    {name:'cross-chromium',use:{...devices['Desktop Chrome']}},
    {name:'cross-firefox',use:{...devices['Desktop Firefox']}},
    {name:'cross-webkit',use:{...devices['Desktop Safari']}}
  ]
});
