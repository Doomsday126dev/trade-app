'use strict';

const fs=require('node:fs');
const path=require('node:path');

const FRONTEND_SOURCE_FILES=Object.freeze([
  'index.html',
  'css/app.css',
  'js/app/application.js'
]);

function readFrontendSource(root){
  return FRONTEND_SOURCE_FILES
    .map(file=>fs.readFileSync(path.join(root,file),'utf8'))
    .join('\n');
}

module.exports={FRONTEND_SOURCE_FILES,readFrontendSource};
