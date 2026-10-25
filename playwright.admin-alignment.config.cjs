const base=require('./playwright.event-sources.config.cjs');module.exports={...base,testMatch:'admin-member-alignment.spec.js',use:{...base.use,baseURL:'http://127.0.0.1:8138'},webServer:undefined};
