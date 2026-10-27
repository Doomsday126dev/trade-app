'use strict';
// Deterministic raster composition of the approved source; no new mascot drawing.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
(async()=>{const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/brand/apri-source-256.png')),browser=await chromium.launch({headless:true}),page=await browser.newPage();
 const records=[];for(const [size,maskable]of [[32,false],[96,false],[180,false],[192,false],[512,false],[512,true]]){
  const data=await page.evaluate(async({src,size,maskable})=>{const im=new Image();im.src=src;await im.decode();const original=document.createElement('canvas');original.width=im.naturalWidth;original.height=im.naturalHeight;const ox=original.getContext('2d');ox.drawImage(im,0,0);const rgba=ox.getImageData(0,0,original.width,original.height).data;let left=original.width,top=original.height,right=0,bottom=0;
   for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++)if(rgba[(y*original.width+x)*4+3]){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
   const cx=(left+right)/2,cy=(top+bottom)/2;let radius=0;for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++)if(rgba[(y*original.width+x)*4+3])radius=Math.max(radius,Math.hypot(x+.5-cx,y+.5-cy));
   const scale=maskable?size*.38/radius:size*.8/Math.max(right-left,bottom-top),canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d');c.fillStyle='#111316';c.fillRect(0,0,size,size);c.imageSmoothingEnabled=true;c.imageSmoothingQuality='high';c.drawImage(im,size/2-cx*scale,size/2-cy*scale,im.naturalWidth*scale,im.naturalHeight*scale);return canvas.toDataURL('image/png');
  },{src:'data:image/png;base64,'+source.toString('base64'),size,maskable});
  const file=`assets/brand/apri-icon-${size}${maskable?'-maskable':''}.png`;const bytes=Buffer.from(data.split(',')[1],'base64');fs.writeFileSync(path.join(root,file),bytes);if(!maskable&&size!==32)fs.writeFileSync(path.join(root,`assets/tradeloop-icon-${size}.png`),bytes);records.push({file,size,maskable,bytes:bytes.length});
 }
 const icon=fs.readFileSync(path.join(root,'assets/brand/apri-icon-96.png')).toString('base64');fs.writeFileSync(path.join(root,'assets/tradeloop-icon.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><image width="96" height="96" href="data:image/png;base64,${icon}"/></svg>\n`);await browser.close();console.log(JSON.stringify(records,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
