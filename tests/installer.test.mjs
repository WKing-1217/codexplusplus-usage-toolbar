import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {manage} from '../scripts/manage.mjs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {collectorParams}=createRequire(import.meta.url)('../src/toolbar.js');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'codex-toolbar-installer-'));
const digest=s=>createHash('sha256').update(s).digest('hex');
test('portable install resolves paths with spaces and is idempotent; uninstall preserves a backup',()=>{
 const data=path.join(temp(),'path with spaces','Codex++');
 const installed=manage({mode:'install','data-root':data});assert.equal(installed.state,'installed-awaiting-script-reload');
 const source=fs.readFileSync(installed.target,'utf8');assert(!source.includes('/*__HELPER__*/null'));assert(source.includes(JSON.stringify(data).slice(1,-1)));
 assert.equal(manage({mode:'install','data-root':data}).state,'already-installed');assert.equal(manage({mode:'status','data-root':data}).hashMatches,true);
 const removed=manage({mode:'uninstall','data-root':data});assert.equal(fs.existsSync(installed.target),false);assert.equal(fs.readFileSync(removed.backup,'utf8'),source);
});
test('an unrelated userscript is never overwritten',()=>{
 const data=temp(),target=path.join(data,'user_scripts','codex-usage-toolbar.js');fs.mkdirSync(path.dirname(target));fs.writeFileSync(target,'unrelated');
 assert.throws(()=>manage({mode:'install','data-root':data}),/receipt/);assert.equal(fs.readFileSync(target,'utf8'),'unrelated');
});
test('verified migration keeps rollback through repeated install; changed files refuse rollback',()=>{
 const data=temp(),target=path.join(data,'user_scripts','codex-usage-toolbar.js'),receipt=path.join(data,'previous.json');
 fs.mkdirSync(path.dirname(target));fs.writeFileSync(target,'previous-owned-script');
 fs.writeFileSync(receipt,JSON.stringify({target,version:'0.1.1',sha256:digest('previous-owned-script')}));
 const installed=manage({mode:'install','data-root':data,'previous-receipt':receipt});assert(installed.backup);
 const again=manage({mode:'install','data-root':data});assert.equal(again.backup,installed.backup);
 const current=fs.readFileSync(target);fs.appendFileSync(target,'changed');assert.throws(()=>manage({mode:'rollback','data-root':data}),/receipt/);fs.writeFileSync(target,current);
 assert.equal(manage({mode:'rollback','data-root':data}).version,'0.1.1');assert.equal(fs.readFileSync(target,'utf8'),'previous-owned-script');
});
test('installed runtime runs from its own directory and uses explicit settings, independent of home and NODE_OPTIONS',()=>{
 const data=temp(),installed=manage({mode:'install','data-root':data});
 const receipt=JSON.parse(fs.readFileSync(path.join(data,'usage-toolbar','installation.json')));
 assert.equal(installed.selfTest,'passed');assert.notEqual(receipt.runtime,process.execPath);
 const settings=path.join(data,'fixture-settings.json');fs.writeFileSync(settings,JSON.stringify({activeRelayId:'relay-fixture',relayProfiles:[{id:'relay-fixture',relayMode:'official',name:'Fixture'}]}));
 const params=collectorParams({...receipt.helper,settings});const env={...process.env,USERPROFILE:path.join(data,'wrong-home')};delete env.NODE_OPTIONS;
 const result=spawnSync(params.command[0],params.command.slice(1),{cwd:params.cwd,env,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).state,'not-api');
 const probe=path.join(data,'permission-probe.cjs');fs.writeFileSync(probe,"const fs=require('node:fs');let denied=0;try{fs.writeFileSync(process.argv[2],'no')}catch(e){if(e.code==='ERR_ACCESS_DENIED')denied++}try{require('node:child_process').spawnSync('whoami')}catch(e){if(e.code==='ERR_ACCESS_DENIED')denied++}process.stdout.write(String(denied));");
 const blocked=spawnSync(receipt.runtime,['--permission','--allow-fs-read='+probe,probe,path.join(data,'must-not-exist')],{encoding:'utf8',windowsHide:true,env});
 assert.equal(blocked.stdout,'2');assert(!fs.existsSync(path.join(data,'must-not-exist')));
});
