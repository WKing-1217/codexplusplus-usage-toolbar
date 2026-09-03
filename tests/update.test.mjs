import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {makePackage,validatePackage,digest} from '../scripts/package.mjs';
import {newer,releaseAsset,update} from '../scripts/update.mjs';
import {manage} from '../scripts/manage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'toolbar-update-')),storage=path.join(data,'usage-toolbar'),target=path.join(data,'user_scripts','codex-usage-toolbar.js');
 fs.mkdirSync(storage);fs.mkdirSync(path.dirname(target));fs.writeFileSync(target,'previous-owned-version');
 const state={schemaVersion:1,version:'1.0.1',target,sha256:digest(fs.readFileSync(target)),installedAt:'fixture'};
 fs.writeFileSync(path.join(storage,'installation.json'),JSON.stringify(state));return{data,storage,target,state};
}
function release(){
 const value=makePackage(root),bytes=Buffer.from(JSON.stringify(value)),version=value.version;
 const metadata={tag_name:'v'+version,draft:false,prerelease:false,assets:[{name:'codexplusplus-usage-toolbar-v'+version+'.update.json',state:'uploaded',digest:'sha256:'+digest(bytes),size:bytes.length,browser_download_url:'https://github.com/WKing-1217/codexplusplus-usage-toolbar/releases/download/v'+version+'/codexplusplus-usage-toolbar-v'+version+'.update.json'}]};
 return{value,bytes,metadata};
}
function requests(metadata,bytes){let calls=0;return async(url,options)=>{
 calls++;assert.equal(options.redirect,'manual');assert(!Object.keys(options.headers).some(k=>k.toLowerCase()==='authorization'));
 assert.equal(String(url),calls===1?'https://api.github.com/repos/WKing-1217/codexplusplus-usage-toolbar/releases/latest':metadata.assets[0].browser_download_url);
 return new Response(calls===1?JSON.stringify(metadata):bytes,{status:200});
};}
test('online update verifies release bytes, installs a self-contained package and retains rollback',async()=>{
 const f=fixture(),r=release();
 const result=await update({dataRoot:f.data,fetchImpl:requests(r.metadata,r.bytes),log:()=>{}});
 assert.equal(result.state,'updated-awaiting-script-reload');assert.equal(result.version,r.value.version);
 const installed=JSON.parse(fs.readFileSync(path.join(f.storage,'installation.json')));assert.equal(fs.readFileSync(installed.previous.file,'utf8'),'previous-owned-version');
 assert(fs.existsSync(path.join(f.storage,'update.cmd')));assert.equal(manage({mode:'repair','data-root':f.data}).version,r.value.version);
 assert.equal(manage({mode:'rollback','data-root':f.data}).version,'1.0.1');assert.equal(fs.readFileSync(f.target,'utf8'),'previous-owned-version');
});
test('corrupt download, failed download and failed installer preserve the current version',async()=>{
 const f=fixture(),r=release(),original=fs.readFileSync(path.join(f.storage,'installation.json'),'utf8');
 const check=()=>{assert.equal(fs.readFileSync(f.target,'utf8'),'previous-owned-version');assert.equal(fs.readFileSync(path.join(f.storage,'installation.json'),'utf8'),original);};
 const corrupt=Buffer.from(r.bytes);corrupt[corrupt.length-1]^=1;
 await assert.rejects(update({dataRoot:f.data,fetchImpl:requests(r.metadata,corrupt),log:()=>{}}),/checksum/);check();
 await assert.rejects(update({dataRoot:f.data,fetchImpl:async()=>new Response('failure',{status:503}),log:()=>{}}),/HTTP 503/);check();
 await assert.rejects(update({dataRoot:f.data,fetchImpl:requests(r.metadata,r.bytes),run:()=>({status:1}),log:()=>{}}),/安装失败/);check();
});
test('updater rejects paths, duplicates, wrong versions, untrusted sources and redirects',async()=>{
 const r=release();
 for(const change of [p=>p.files[0].name='../settings.json',p=>p.files[1].name=p.files[0].name,p=>p.version='9.9.9',p=>p.files[0].sha256='0'.repeat(64)]){const value=structuredClone(r.value);change(value);assert.throws(()=>validatePackage(value,r.value.version));}
 for(const change of [m=>m.prerelease=true,m=>m.draft=true,m=>m.assets[0].browser_download_url='https://example.com/update.json',m=>m.assets[0].digest=null]){const value=structuredClone(r.metadata);change(value);assert.throws(()=>releaseAsset(value));}
 const f=fixture();let count=0;
 await assert.rejects(update({dataRoot:f.data,fetchImpl:async()=>{count++;return new Response(null,{status:302,headers:{location:'https://example.com/update.json'}});},log:()=>{}}),/redirect/);assert.equal(count,1);
});
test('same-version and older releases do not download or downgrade; changed user scripts are preserved',async()=>{
 assert.equal(newer('1.10.0','1.9.9'),true);assert.equal(newer('1.0.1','1.0.2'),false);
 const f=fixture(),r=release();
 for(const version of [r.value.version,'9.0.0']){
  fs.writeFileSync(path.join(f.storage,'installation.json'),JSON.stringify({...f.state,version}));let calls=0;
  const result=await update({dataRoot:f.data,fetchImpl:async()=>{calls++;return new Response(JSON.stringify(r.metadata));},log:()=>{}});assert.equal(result.state,'up-to-date');assert.equal(calls,1);
 }
 fs.appendFileSync(f.target,'user edit');await assert.rejects(update({dataRoot:f.data,fetchImpl:async()=>{throw new Error('must not fetch');},log:()=>{}}),/receipt/);assert(fs.readFileSync(f.target,'utf8').endsWith('user edit'));
});
