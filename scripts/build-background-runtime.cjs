const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),file=path.join(root,'js/domain/backgroundPersistence.js');
const marker='// END OWNER-DATA ADAPTER PRELUDE\n',source=fs.readFileSync(file,'utf8'),at=source.indexOf(marker);
if(at<0)throw Error('Missing bounded owner-data bundle boundary');
const expected='// Owner-data adapter prelude: exact cacheAdapters.js source; checked by build-background-runtime.cjs.\n'+fs.readFileSync(path.join(root,'js/domain/cacheAdapters.js'),'utf8').replace('})(window);',"})(typeof window!=='undefined'?window:globalThis);")+'\n'+marker+source.slice(at+marker.length);
if(process.argv.includes('--write'))fs.writeFileSync(file,expected);else if(source!==expected)throw Error('Owner-data adapter bundle is stale');
