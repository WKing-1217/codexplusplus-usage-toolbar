import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {manage} from '../scripts/manage.mjs';
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
