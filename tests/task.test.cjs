const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{spawnSync}=require('node:child_process');
const{collectTask}=require('../src/balance.cjs');
const{taskParams,parseTaskResult,normalizeTaskPath}=require('../src/toolbar.js');
const id='12345678-1234-1234-1234-123456789abc';
test('Windows extended file paths normalize consistently in both read permission and task arguments',()=>{
 const file='C:\\Users\\fixture\\.codex\\sessions\\rollout-'+id+'.jsonl',extended='\\\\?\\'+file;
 const p=taskParams({node:'node',script:'collector',cwd:'C:\\fixture'},id,extended);
 assert.equal(normalizeTaskPath(extended),file);assert.equal(p.command.at(-1),file);assert(p.command.includes('--allow-fs-read='+file));assert(!p.command.some(v=>v.includes('\\\\?\\')));
 assert.equal(normalizeTaskPath('\\\\?\\UNC\\server\\share\\sessions\\rollout-'+id+'.jsonl'),'\\\\server\\share\\sessions\\rollout-'+id+'.jsonl');
});
const event=(total,time='2026-09-03T00:00:00Z')=>JSON.stringify({type:'event_msg',timestamp:time,payload:{type:'token_count',info:{total_token_usage:{input_tokens:total-10,cached_input_tokens:20,output_tokens:10,reasoning_output_tokens:5,total_tokens:total},last_token_usage:{total_tokens:30},model_context_window:1000}}})+'\n';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'toolbar-task-')),dir=path.join(root,'sessions');fs.mkdirSync(dir);const file=path.join(dir,'rollout-'+id+'.jsonl');fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'turn_context',payload:{model:'fixture-model'}})+'\n');return{root,file};}
test('task collector reads large closed histories, filters output, and finds latest complete usage',async()=>{
 const{file}=fixture();fs.appendFileSync(file,event(100));fs.appendFileSync(file,JSON.stringify({type:'response_item',payload:{content:'PRIVATE_CHAT_SENTINEL'+'x'.repeat(17*1024*1024)}})+'\n');fs.appendFileSync(file,event(200,'2026-09-03T00:01:00Z')+'{"partial":');
 const result=await collectTask({taskId:id,taskPath:file});assert.equal(result.available,true);assert.equal(result.info.total_token_usage.total_tokens,200);assert(result.bytesRead<=1024*1024);assert(!JSON.stringify(result).includes('PRIVATE_CHAT_SENTINEL'));assert(!JSON.stringify(result).includes(file));
 const value=parseTaskResult({exitCode:0,stdout:JSON.stringify(result)},id);assert.equal(value.total,200);assert.equal(value.fresh,170);assert.equal(value.contextRemaining,970);
});
test('reverse scan crosses huge non-token lines and chunk boundaries without inventing usage',async()=>{
 const{file}=fixture();fs.appendFileSync(file,event(123));fs.appendFileSync(file,JSON.stringify({type:'response_item',payload:{content:'中'.repeat(3*1024*1024)}})+'\n');
 const result=await collectTask({taskId:id,taskPath:file});assert.equal(result.available,true);assert.equal(result.info.total_token_usage.total_tokens,123);
});
test('task identity, file location, missing files and no-usage remain distinct',async()=>{
 const{root,file}=fixture();assert.equal((await collectTask({taskId:id,taskPath:file})).code,'task_empty');
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'23456789-2345-2345-2345-23456789abcd'}})+'\n'+event(99));assert.equal((await collectTask({taskId:id,taskPath:file})).code,'task_identity');
 assert.equal((await collectTask({taskId:id,taskPath:path.join(root,'auth.json')})).code,'task_path');
 fs.unlinkSync(file);assert.equal((await collectTask({taskId:id,taskPath:file})).code,'task_missing');
 assert.throws(()=>parseTaskResult({exitCode:0,stdout:JSON.stringify({schemaVersion:1,state:'task',threadId:'other',available:true})},id),e=>e.code==='task_identity');
});
test('bounded scan reports a limit instead of showing zero for huge histories without recent usage',async()=>{
 const{file}=fixture();fs.appendFileSync(file,event(100));fs.truncateSync(file,65*1024*1024);
 const result=await collectTask({taskId:id,taskPath:file});assert.equal(result.available,false);assert.equal(result.code,'task_scan_limit');
});
test('real task command reads only the selected log, has no settings grant, and needs no service credentials',()=>{
 const{root,file}=fixture();fs.appendFileSync(file,event(321));const script=path.resolve(__dirname,'../src/balance.cjs');const helper={node:process.execPath,script,cwd:root,settings:path.join(root,'must-not-read-settings.json'),allowNet:true};
 const params=taskParams(helper,id,file);assert(!params.command.includes('--allow-net'));assert(!params.command.some(v=>v.includes(helper.settings)));assert(!('sandboxPolicy'in params));
 const r=spawnSync(params.command[0],params.command.slice(1),{cwd:params.cwd,encoding:'utf8',windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});assert.equal(r.status,0,r.stderr);assert.equal(parseTaskResult({exitCode:r.status,stdout:r.stdout},id).total,321);
 const denied=params.command.filter(v=>v!=='--allow-fs-read='+file);const blocked=spawnSync(denied[0],denied.slice(1),{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,NODE_OPTIONS:''}});assert.equal(JSON.parse(blocked.stdout).code,'task_permission');
});
