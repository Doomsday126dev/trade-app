'use strict';

const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const {createHash}=require('node:crypto');

function expressionKey(source){
  return JSON.stringify([...acorn.tokenizer(source,{ecmaVersion:'latest'})].map(token=>[token.type.label,token.value??null]));
}

function collectReadSites(root,{repository=false}={}){
  const result=[];
  function inspect(source,file,lineOffset=0){
    const tree=acorn.parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});
    function visit(node,handler='<top-level>',handlerHash=''){
      if(!node||typeof node!=='object')return;
      if(node.type==='FunctionDeclaration'){
        handler=node.id?.name||handler;
        handlerHash=createHash('sha256').update(expressionKey(source.slice(node.start,node.end))).digest('hex');
      }
      if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&['get','onValue'].includes(node.callee.name)){
        if(!repository)result.push({file,line:node.loc.start.line+lineOffset,handler,handlerHash,operation:node.callee.name,expression:source.slice(node.start,node.end)});
      }
      if(repository&&node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='client'){
        const method=node.callee.computed?node.callee.property.value:node.callee.property.name;
        if(node.callee.computed&&typeof method!=='string')throw new Error(`Dynamic client method requires review: ${file}:${node.loc.start.line}`);
        if(['read','listen'].includes(method))result.push({file,line:node.loc.start.line+lineOffset,handler,operation:method,expression:source.slice(node.start,node.end)});
      }
      for(const [key,value] of Object.entries(node)){
        if(['loc','start','end'].includes(key))continue;
        if(Array.isArray(value))value.forEach(child=>visit(child,handler,handlerHash));
        else if(value&&typeof value==='object')visit(value,handler,handlerHash);
      }
    }
    visit(tree);
  }
  if(repository){
    function scan(directory){
      for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        const file=`${directory}/${entry.name}`;
        if(entry.isDirectory())scan(file);
        else if(entry.isFile()&&file.endsWith('.js'))inspect(fs.readFileSync(path.join(root,file),'utf8'),file);
      }
    }
    scan('js');return result;
  }
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
    const offset=html.slice(0,match.index+match[0].indexOf('>')+1).split('\n').length-1;
    inspect(match[1],'index.html',offset);
  }
  inspect(fs.readFileSync(path.join(root,'js/app/application.js'),'utf8'),'js/app/application.js');
  return result;
}

function reconcileReadSites(actual,reviewed,handlerHashes){
  const assert=require('node:assert/strict');
  assert.equal(actual.length,reviewed.length,'Direct Firebase read inventory changed; review every added/removed site');
  return actual.map((site,index)=>{
    const contract=reviewed[index];
    for(const field of ['file','handler','operation'])assert.equal(site[field],contract[field],`Read site ${index+1}: ${field} changed`);
    assert.equal(expressionKey(site.expression),expressionKey(contract.expression),`Read site ${index+1}: expression changed`);
    assert.equal(site.handlerHash,handlerHashes[site.handler],`Read handler ${site.handler}: path bindings or execution semantics changed`);
    return {...contract,...site};
  });
}

module.exports={collectReadSites,expressionKey,reconcileReadSites};
