import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const PACKAGE_FILES=Object.freeze(['package.json','install.cmd','diagnose.cmd','uninstall.cmd','rollback.cmd','repair.cmd','update.cmd','scripts/launch.cmd','scripts/manage.mjs','scripts/windows-acl.mjs','scripts/package.mjs','scripts/update.mjs','src/toolbar.js','dist/codex-usage-toolbar.template.js','dist/balance.cjs','dist/release.json']);
export const digest=data=>createHash('sha256').update(data).digest('hex');
export function makePackage(root){
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 const files=PACKAGE_FILES.map(name=>{const contents=fs.readFileSync(path.join(root,name));return{name,sha256:digest(contents),data:contents.toString('base64')};});
 return {schemaVersion:1,repository:'WKing-1217/codexplusplus-usage-toolbar',version,files};
}
export function validatePackage(value,version){
 if(value?.schemaVersion!==1||value.repository!=='WKing-1217/codexplusplus-usage-toolbar'||value.version!==version||!/^\d+\.\d+\.\d+$/.test(version)||!Array.isArray(value.files)||value.files.length!==PACKAGE_FILES.length)throw new Error('Invalid update package');
 const seen=new Set();
 for(const entry of value.files){
  if(!PACKAGE_FILES.includes(entry.name)||seen.has(entry.name)||typeof entry.data!=='string'||entry.data.length>2*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data))throw new Error('Unexpected update file');
  seen.add(entry.name);const bytes=Buffer.from(entry.data,'base64');if(digest(bytes)!==entry.sha256)throw new Error('Update file checksum mismatch');
 }
 const read=name=>JSON.parse(Buffer.from(value.files.find(f=>f.name===name).data,'base64').toString('utf8'));
 if(read('package.json').version!==version||read('dist/release.json').version!==version)throw new Error('Update version mismatch');
 return value;
}
export function storePackage(storage,value){
 validatePackage(value,value.version);
 const id=value.version+'-'+digest(JSON.stringify(value)).slice(0,16),root=path.resolve(storage,'manager'),destination=path.join(root,id);
 if(fs.existsSync(root)&&fs.lstatSync(root).isSymbolicLink())throw new Error('Manager path is a link');
 fs.mkdirSync(destination,{recursive:true});
 if(fs.lstatSync(destination).isSymbolicLink())throw new Error('Package path is a link');
 for(const entry of value.files){
  const target=path.join(destination,entry.name),parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
  if(fs.lstatSync(parent).isSymbolicLink())throw new Error('Package directory is a link');
  if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink()||digest(fs.readFileSync(target))!==entry.sha256)throw new Error('Existing package was modified');}
  else fs.writeFileSync(target,Buffer.from(entry.data,'base64'),{flag:'wx'});
 }
 return destination;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),value=makePackage(root);validatePackage(value,value.version);
 if(!process.argv[2])throw new Error('Specify an output file');fs.writeFileSync(process.argv[2],JSON.stringify(value));console.log('Built verified update package '+value.version);
}
