const test=require('node:test'),assert=require('node:assert/strict');
const {selectProfile,baseFromConfig,parseSub2api,parseNewApi,requestJson,query}=require('../src/balance.cjs');
test('saved profile picks only its own key and origin; official stays official',()=>{
 const s={activeRelayId:'a',relayProfiles:[{id:'a',name:'Official',relayMode:'official'},{id:'b',name:'Plus',relayMode:'pureApi',authContents:JSON.stringify({OPENAI_API_KEY:'fake-key'}),upstreamBaseUrl:'https://example.test/v1'}]};
 assert.equal(selectProfile(s).mode,'account');assert.equal(selectProfile(s,'b').key,'fake-key');
 assert.throws(()=>selectProfile(s,'missing'),/configuration/);
 s.relayProfiles[1].upstreamBaseUrl='https://name:password@example.test/v1';assert.throws(()=>selectProfile(s,'b'),/configuration/);
 assert.equal(baseFromConfig('model_provider = "x"\n[model_providers.x]\nbase_url = "https://example.test/v1"'),'https://example.test/v1');
});
test('wallet balances are not inferred from Plus names; zero and debt are real amounts',()=>{
 for(const remaining of [0,-2,123.456]){const b=parseSub2api({mode:'unrestricted',isValid:true,planName:'钱包余额',unit:'USD',remaining,balance:remaining});assert.equal(b.kind,'钱包余额');assert.equal(b.plan,null);assert.equal(b.remaining,remaining);assert.equal(b.unlimited,false);}
});
test('subscription name, expiry, each window and limiting balance are preserved',()=>{
 const b=parseSub2api({mode:'unrestricted',isValid:true,planName:'专业月套餐',unit:'USD',remaining:5,subscription:{daily_limit_usd:10,daily_usage_usd:5,weekly_limit_usd:100,weekly_usage_usd:80,monthly_limit_usd:300,monthly_usage_usd:100,expires_at:'2099-01-01T00:00:00Z'}});
 assert.equal(b.kind,'套餐余额');assert.equal(b.plan.name,'专业月套餐');assert.equal(b.plan.state,'active');assert.equal(b.remaining,5);assert.deepEqual(b.windows.map(w=>w.remaining),[5,20,200]);
 assert.equal(b.windows[0].resetsAt,null);
});
test('unlimited, expired and missing subscription details do not become zero',()=>{
 const b=parseSub2api({mode:'unrestricted',isValid:true,planName:'包年',unit:'USD',remaining:-1,subscription:{expires_at:'2000-01-01T00:00:00Z'}});
 assert.equal(b.unlimited,true);assert.equal(b.remaining,null);assert.equal(b.plan.state,'expired');
 const unknown=parseSub2api({mode:'unrestricted',isValid:true,planName:'订阅',unit:'USD'});
 assert.equal(unknown.remaining,null);assert.equal(unknown.plan.state,'details-unavailable');
});
test('key quota remains distinct from wallet or a subscription',()=>{
 const b=parseSub2api({mode:'quota_limited',isValid:true,unit:'USD',remaining:0,quota:{limit:10,used:10},rate_limits:[{window:'5h',limit:10,used:10,remaining:0,reset_at:'2099-01-01T00:00:00Z'}]});
 assert.equal(b.kind,'密钥额度');assert.equal(b.plan,null);assert.equal(b.remaining,0);assert.equal(b.windows[0].remaining,0);
});
test('New API internal quota is not silently converted to dollars',()=>{
 const b=parseNewApi({code:true,data:{object:'token_usage',unlimited_quota:false,total_available:500000,total_used:0,total_granted:500000,expires_at:0}});
 assert.equal(b.remaining,500000);assert.equal(b.currency,null);assert.equal(b.expiresAt,null);
 assert.equal(parseNewApi({balance:20}),null);
});
test('redirects and authentication errors stop before any fallback; messages never echo response bodies',async()=>{
 for(const [status,code] of [[302,'redirect'],[401,'unauthorized'],[403,'forbidden'],[429,'rate_limited'],[503,'unavailable']]){
  let calls=0;await assert.rejects(()=>query({base:'https://example.test/v1',key:'fake-secret'},{fetchImpl:async()=>{calls++;return new Response('fake-secret',{status});}}),new RegExp(code));assert.equal(calls,1);
 }
});
test('only known same-origin read endpoints receive key; invalid HTML is not a balance',async()=>{
 const seen=[];const result=await query({base:'https://example.test/prefix/v1',key:'fake-secret'},{fetchImpl:async(url,options)=>{
  seen.push(String(url));assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,'Bearer fake-secret');
  return seen.length===1?new Response('<html/>',{headers:{'content-type':'text/html'}}):Response.json({code:true,data:{object:'token_usage',unlimited_quota:true}});
 }});
 assert.deepEqual(seen,['https://example.test/prefix/v1/usage','https://example.test/prefix/api/usage/token']);assert.equal(result.unlimited,true);
});
