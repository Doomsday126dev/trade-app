'use strict';
// Monitor only. Include sprite resolver bodies, their helper dependencies and
// direct rendering consumers; unrelated application UI must not repin artwork.
const acorn=require('acorn'),crypto=require('node:crypto');
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))value.forEach(v=>walk(v,visit));else if(value&&typeof value==='object')walk(value,visit);}}
function applicationSpriteScope(source){
 const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'}),declarations=new Map();
 for(const node of ast.body){if(node.type==='FunctionDeclaration')declarations.set(node.id.name,node);else if(node.type==='VariableDeclaration')for(const declaration of node.declarations)if(declaration.id.type==='Identifier')declarations.set(declaration.id.name,declaration);}
 const roots=new Set([...declarations.keys()].filter(name=>/sprite/i.test(name)));
 for(const required of ['spriteUrl','spriteFallbackChain','spriteImg','exportSpriteUrl'])if(!roots.has(required))throw Error('Sprite monitor scope missing '+required);
 const references=node=>{const names=new Set();walk(node,part=>{if(part.type==='Identifier')names.add(part.name);});return names;};
 const selected=new Set(roots),pending=[...roots];
 // Follow resolver helper/constant dependencies, including nested callbacks.
 while(pending.length){for(const name of references(declarations.get(pending.pop())))if(declarations.has(name)&&!selected.has(name)){selected.add(name);pending.push(name);}}
 // Capture arguments passed by owner/shared/canvas consumers, without hashing
 // unrelated UI dependencies of a whole render function transitively.
 for(const [name,node]of declarations)if(node.type==='FunctionDeclaration'&&[...references(node)].some(ref=>roots.has(ref)))selected.add(name);
 const parts=[...selected].sort().map(name=>[name,source.slice(declarations.get(name).start,declarations.get(name).end)]);
 // Global image error/fallback listeners are not function declarations.
 for(const node of ast.body)if(!['FunctionDeclaration','VariableDeclaration'].includes(node.type)&&[...references(node)].some(ref=>roots.has(ref)))parts.push(['top-level',source.slice(node.start,node.end)]);
 const tokens=text=>[...acorn.tokenizer(text,{ecmaVersion:'latest'})].map(token=>[token.type.label,token.value??null]);
 return{schemaVersion:2,names:[...selected].sort(),hash:crypto.createHash('sha256').update(JSON.stringify(parts.map(([name,text])=>[name,tokens(text)]))).digest('hex')};
}
module.exports={applicationSpriteScope};
