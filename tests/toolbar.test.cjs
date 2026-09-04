const test=require('node:test');
const assert=require('node:assert/strict');
const {threadFromPath,validRollout,isApiUsage,parseSession,liveUsage,createHostMessageDecoder}=require('../src/toolbar.js');
const id='12345678-1234-1234-1234-123456789abc';
test('only exact local routes resolve; cloud and settings never reuse a task',()=>{
 assert.equal(threadFromPath('/local/'+id),id);assert.equal(threadFromPath('/hotkey-window/thread/'+id),id);
 for(const p of ['/','/settings','/remote/'+id,'/local/no-id','/local/'+id+'/other'])assert.equal(threadFromPath(p),null);
});
test('only selected rollout paths are accepted, no unrelated files or network URLs',()=>{
 assert.equal(validRollout('C:\\Users\\x\\.codex\\sessions\\2026\\rollout-'+id+'.jsonl',id),true);
 for(const p of ['C:/auth.json','https://host/sessions/rollout-'+id+'.jsonl','C:/sessions/../rollout-'+id+'.jsonl','C:/sessions/rollout-other.jsonl'])assert.equal(validRollout(p,id),false);
});
test('cache and reasoning are subsets, latest record wins, unknown remains null',()=>{
 const events=[{type:'turn_context',payload:{model:'test'}},{type:'event_msg',timestamp:'2026-09-02T00:00:00Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,cached_input_tokens:800,output_tokens:100,reasoning_output_tokens:40,total_tokens:1100},last_token_usage:{total_tokens:200},model_context_window:10000}}}];
 const value=parseSession('broken\n'+events.map(e=>JSON.stringify(e)).join('\n')+'\n{"partial":');
 assert.equal(value.total,1100);assert.equal(value.fresh,200);assert.equal(value.cachePercent,80);assert.equal(value.contextRemaining,9800);assert.equal(value.reasoning,40);
 assert.equal(parseSession('').available,false);
 const live=liveUsage({total:{totalTokens:9},last:{totalTokens:4},modelContextWindow:10});assert.equal(live.total,9);assert.equal(live.input,null);assert.equal(live.contextRemaining,6);
});
test('API toolbar does not poll official account quota or activate task reads for official login',()=>{
 assert.equal(isApiUsage({mode:'account',state:'not-api'}),false);assert.equal(isApiUsage(null),false);assert.equal(isApiUsage({mode:'api',state:'ok'}),true);
 assert.equal(isApiUsage({mode:'api',activeMode:'account',state:'ok'}),false);assert.equal(isApiUsage({mode:'api',activeMode:'api',state:'error'}),true);
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/toolbar.js'),'utf8');assert(!source.includes('account/read'));assert(!source.includes('account/rateLimits/read'));
 assert(!source.includes('app-initial-'));assert(!source.includes('unsupported-version'));assert(!source.includes('ADAPTERS'));
});
test('version-independent host decoder accepts direct and chunked messages with acknowledgements',()=>{
 const acknowledgements=[],bridge={acknowledgeChunkedMessage:(transferId,sequence)=>acknowledgements.push([transferId,sequence])};
 const target={location:{origin:'app://-'}},decode=createHostMessageDecoder(bridge,target);
 assert.deepEqual(decode({source:null,data:{type:'mcp-response',message:{id:'direct'}}}),{type:'mcp-response',message:{id:'direct'}});
 const chunk=(sequence,kind,tokens)=>({source:null,data:{marker:'codex-host-chunked-message-v1',transferId:'fixture',sequence,kind,...tokens&&{tokens}}});
 assert.equal(decode(chunk(0,'start')),null);
 assert.equal(decode(chunk(1,'chunk',[{type:'object-start'},{type:'key',value:'type'},{type:'value',value:'mcp-response'},{type:'key',value:'message'},{type:'object-start'},{type:'key',value:'id'},{type:'string-start',target:'value'},{type:'string-chunk',value:'chunk'},{type:'string-chunk',value:'ed'},{type:'string-end'},{type:'container-end'},{type:'container-end'}])),null);
 assert.deepEqual(decode(chunk(2,'end')),{type:'mcp-response',message:{id:'chunked'}});
 assert.deepEqual(acknowledgements,[['fixture',0],['fixture',1],['fixture',2]]);
 const reject=createHostMessageDecoder(bridge,target),outOfOrder=(sequence,kind,tokens)=>({source:null,data:{marker:'codex-host-chunked-message-v1',transferId:'out-of-order',sequence,kind,...tokens&&{tokens}}});
 assert.equal(reject(outOfOrder(7,'start')),null);
 assert.equal(reject(outOfOrder(9,'end')),null);
 assert.equal(reject(outOfOrder(8,'end')),null);
 assert.equal(decode({source:{},data:{type:'mcp-response'}}),null);
});
