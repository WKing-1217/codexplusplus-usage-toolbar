const test=require('node:test'),assert=require('node:assert/strict');
const {collectorParams,collectorFailure,parseCollectorResult}=require('../src/toolbar.js');
test('collector has a fixed cwd, explicit settings path and read-only Node permissions; host policy stays inherited',()=>{
 const h={node:'C:\\path with spaces\\node.exe',script:'C:\\用户\\balance.cjs',cwd:'C:\\用户',settings:'C:\\用户\\settings.json'};
 const p=collectorParams(h,'relay-test');
 assert.deepEqual(p.command,[h.node,'--permission','--allow-fs-read='+h.script,'--allow-fs-read='+h.settings,h.script,'--settings-path',h.settings,'--profile-id','relay-test']);
 assert.equal(p.cwd,h.cwd);assert.equal(p.env.NODE_OPTIONS,null);assert(!('sandboxPolicy' in p));assert(!('permissionProfile' in p));assert(!('outputBytesCap' in p));
 assert(collectorParams({...h,allowNet:true}).command.includes('--allow-net'));assert(!p.command.includes('--allow-net'));
 assert.throws(()=>collectorParams(h,'--eval'),/安装信息/);assert.throws(()=>collectorParams({}),/安装信息/);
});
test('collector failures explain the failing stage without echoing secrets or raw errors',()=>{
 for(const [input,code] of [['CreateProcessAsUserW failed: 5 (Access denied)','runtime_access'],['CreateProcessAsUser sandbox setup failed','sandbox'],['spawn ENOENT','missing'],['Access denied','permission'],['Read timeout','timeout'],['node: bad option','runtime'],['method not found','unsupported']]){
  const error=collectorFailure('rpc',input+' secret-value-account');assert.equal(error.code,'collector_'+code);assert(!error.message.includes('secret-value'));assert(!error.message.includes(input));
 }
 assert.throws(()=>parseCollectorResult({exitCode:124,stdout:''}),e=>e.code==='collector_timeout');
 assert.throws(()=>parseCollectorResult({exitCode:1,stderr:'node: bad option: secret-option'}),e=>e.code==='collector_runtime'&&!e.message.includes('secret-option'));
 assert.throws(()=>parseCollectorResult({exitCode:0,stdout:'partial secret-value'}),e=>e.code==='collector_output');
 const balance={schemaVersion:1,state:'ok',remaining:0};assert.deepEqual(parseCollectorResult({exitCode:0,stdout:JSON.stringify(balance)}),balance);
});
