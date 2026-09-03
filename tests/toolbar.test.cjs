const test=require('node:test');
const assert=require('node:assert/strict');
const {threadFromPath,validRollout,normalizeAccount,parseSession,liveUsage}=require('../src/toolbar.js');
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
test('quota prefers codex bucket and does not substitute another model',()=>{
 const account={type:'chatgpt',planType:'pro'};
 const a=normalizeAccount(account,{rateLimitsByLimitId:{codex:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:123}}}});
 assert.equal(a.primary.remaining,75);assert.equal(a.resets,null);
 assert.equal(normalizeAccount(account,{rateLimitsByLimitId:{other:{primary:{usedPercent:0}}},rateLimits:{primary:{usedPercent:0}}}).primary,null);
});
