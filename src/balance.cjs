'use strict';
// Codex++ Usage Toolbar 1.0.4: one-shot, read-only API balance and task token collector.
// Credentials never leave this process except as auth headers to their configured origin.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const positive=v=>finite(v)!==null&&v>=0?v:null;
const text=v=>typeof v==='string'?v.trim():'';
class BalanceError extends Error {constructor(code){super(code);this.code=code;}}
const messages={configuration:'服务商配置无法读取，请检查 Codex++ 当前供应商。',credentials:'当前 API 配置没有可用密钥。',unsupported:'服务商没有返回支持的余额格式。',unauthorized:'服务商拒绝此密钥，请检查密钥是否有效。',forbidden:'当前密钥无权查询余额。',rate_limited:'服务商查询限流，请稍后刷新。',unavailable:'服务商暂时不可用。',network:'余额查询超时或网络不可达。',redirect:'服务商返回重定向，已停止携带密钥跳转。',changed:'供应商已切换，正在等待下一次刷新。',protocol:'余额接口返回数据不完整。'};
function json(s){try{return JSON.parse(s);}catch{return null;}}
function baseFromConfig(contents){
 // Only a declared model provider's base_url is eligible; never select a VLM/MCP URL.
 const lines=text(contents).split(/\r?\n/);let section='',provider=null;const urls=new Map();
 for(const line of lines){const s=line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);if(s){section=s[1].trim();continue;}
  const m=line.match(/^\s*(model_provider|base_url)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);if(!m)continue;
  const v=m[2][0]==='"'?json(m[2]):m[2].slice(1,-1);if(typeof v!=='string')continue;
  if(section===''&&m[1]==='model_provider')provider=v;
  if(section.startsWith('model_providers.')&&m[1]==='base_url')urls.set(section.slice(16).replace(/^['"]|['"]$/g,''),v);
 }
 return provider?urls.get(provider)||'':urls.size===1?[...urls.values()][0]:'';
}
function selectProfile(settings,profileId){
 const id=profileId||settings.activeRelayId;
 const p=settings.relayProfiles?.find(p=>p.id===id);
 if(!p)throw new BalanceError('configuration');
 if(p.relayMode==='official'&&!p.officialMixApiKey)return{mode:'account',id:p.id,name:text(p.name)||'ChatGPT'};
 const auth=json(p.authContents||'{}');
 const key=text(auth?.OPENAI_API_KEY)||text(p.apiKey);
 if(!key||p.noAuth)throw new BalanceError('credentials');
 const base=text(p.upstreamBaseUrl)||baseFromConfig(p.configContents);
 let url;try{url=new URL(base);}catch{throw new BalanceError('configuration');}
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))))throw new BalanceError('configuration');
 return{mode:'api',id:p.id,name:text(p.name).slice(0,80)||url.hostname,base:url.href.replace(/\/$/,''),key};
}
const identity=p=>crypto.createHash('sha256').update(JSON.stringify([p.mode,p.id,p.base,p.key])).digest('hex');
function parseSub2api(d){
 if(!d||!['quota_limited','unrestricted'].includes(d.mode)||typeof d.isValid!=='boolean')return null;
 const currency=['USD','CNY','EUR'].includes(d.unit)?d.unit:null;
 const remaining=finite(d.remaining),balance=finite(d.balance),subscription=d.subscription;
 const unlimited=remaining===-1&&d.mode==='unrestricted'&&!!subscription;
 const kind=d.mode==='quota_limited'?'密钥额度':subscription||d.planName&&d.planName!=='钱包余额'?'套餐余额':balance!==null?'钱包余额':'可用额度';
 const windows=(Array.isArray(d.rate_limits)?d.rate_limits:[]).slice(0,8).map(w=>({label:text(w.window).slice(0,20),limit:positive(w.limit),used:positive(w.used),remaining:positive(w.remaining),resetsAt:date(w.reset_at)}));
 if(subscription){for(const [key,label] of [['daily','每日'],['weekly','每周'],['monthly','每月']]){
  const limit=positive(subscription[key+'_limit_usd']),used=positive(subscription[key+'_usage_usd']);
  if(limit!==null&&limit>0)windows.push({label,limit,used,remaining:used===null?null:Math.max(0,limit-used),resetsAt:null});
 }}
 const planName=kind==='套餐余额'?text(d.planName).slice(0,100)||'当前密钥套餐':null;
 const expiresAt=date(d.expires_at||subscription?.expires_at);
 const plan=planName?{name:planName,scope:'current-key',state:expiresAt&&Date.parse(expiresAt)<=Date.now()?'expired':subscription?'active':'details-unavailable',expiresAt,unlimited,remaining:unlimited?null:remaining}:null;
 return{adapter:'sub2api',kind,currency,unit:currency||'服务商单位',remaining:unlimited?null:remaining,unlimited,balance,plan,
  limit:positive(d.quota?.limit),used:positive(d.quota?.used),windows,
  todaySpent:positive(d.usage?.today?.actual_cost),totalSpent:positive(d.usage?.total?.actual_cost),
  todayRequests:positive(d.usage?.today?.requests),expiresAt,
  warning:plan?.state==='expired'?'套餐已到期，账面额度不代表仍可使用。':d.isValid===false?'密钥当前不可用。':d.status==='expired'?'密钥已过期。':d.status==='quota_exhausted'?'密钥额度已用尽。':null};
}
function parseNewApi(d){
 const v=d?.data;if(d?.code!==true||v?.object!=='token_usage'||typeof v.unlimited_quota!=='boolean')return null;
 if(!v.unlimited_quota&&finite(v.total_available)===null)throw new BalanceError('protocol');
 // New API exposes internal quota units here. Never silently assume dollars or 500000/$.
 return{adapter:'new-api',kind:'密钥额度',currency:null,unit:'额度单位',remaining:v.unlimited_quota?null:finite(v.total_available),unlimited:v.unlimited_quota,
  balance:null,limit:positive(v.total_granted),used:positive(v.total_used),windows:[],todaySpent:null,totalSpent:null,todayRequests:null,
  expiresAt:typeof v.expires_at==='number'&&v.expires_at>0?date(v.expires_at*1000):null,warning:null};
}
function date(value){if(value==null||value==='')return null;const t=new Date(value);return Number.isNaN(t.valueOf())?null:t.toISOString();}
async function requestJson(url,key,{fetchImpl=fetch,timeoutMs=6000}={}){
 let response;try{response=await fetchImpl(url,{headers:{accept:'application/json',authorization:'Bearer '+key},redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}catch{throw new BalanceError('network');}
 if(response.status>=300&&response.status<400)throw new BalanceError('redirect');
 if(response.status===401)throw new BalanceError('unauthorized');if(response.status===403)throw new BalanceError('forbidden');
 if(response.status===429)throw new BalanceError('rate_limited');if(response.status>=500)throw new BalanceError('unavailable');
 if(response.status===404||response.status===405)return null;
 if(!response.ok)throw new BalanceError('protocol');
 if(!/application\/json/i.test(response.headers.get('content-type')||''))return null;
 const reader=response.body.getReader();let total=0;const chunks=[];
 try{while(true){const r=await reader.read();if(r.done)break;total+=r.value.byteLength;if(total>512*1024){await reader.cancel();throw new BalanceError('protocol');}chunks.push(Buffer.from(r.value));}}
 catch(e){if(e instanceof BalanceError)throw e;throw new BalanceError('network');}
 const value=json(Buffer.concat(chunks).toString('utf8'));if(!value)throw new BalanceError('protocol');return value;
}
async function query(profile,options={}){
 const base=new URL(profile.base);const versioned=base.pathname.replace(/\/$/,'').match(/\/v\d+(?:beta)?$/);
 const prefix=versioned?base.pathname.replace(/\/v\d+(?:beta)?$/,''):base.pathname.replace(/\/$/,'');
 const sub=new URL(base);sub.pathname=prefix+'/v1/usage';
 const api=new URL(base);api.pathname=prefix+'/api/usage/token';
 let d=await requestJson(sub,profile.key,options);let result=parseSub2api(d);
 if(!result){d=await requestJson(api,profile.key,options);result=parseNewApi(d);}
 if(!result)throw new BalanceError('unsupported');return result;
}
async function collect({settingsPath=path.join(os.homedir(),'.codex-session-delete','settings.json'),profileId,fetchImpl}={}){
 let p,activeMode=null,profiles=[];try{
  const settings=json(await fs.readFile(settingsPath,'utf8'));if(!settings)throw new BalanceError('configuration');
  const active=settings.relayProfiles?.find(v=>v.id===settings.activeRelayId);if(active)activeMode=active.relayMode==='official'&&!active.officialMixApiKey?'account':'api';
  profiles=(settings.relayProfiles||[]).filter(v=>v.relayMode!=='official'||v.officialMixApiKey).map(v=>({id:v.id,name:text(v.name).slice(0,80)}));
  p=selectProfile(settings,profileId);
  if(p.mode==='account')return{schemaVersion:1,mode:'account',activeMode,state:'not-api',provider:p.name,profiles,updatedAt:new Date().toISOString()};
  const result=await query(p,{fetchImpl});
  const latest=selectProfile(json(await fs.readFile(settingsPath,'utf8')),profileId);
  if(identity(latest)!==identity(p))throw new BalanceError('changed');
  return{schemaVersion:1,mode:'api',activeMode,state:'ok',provider:p.name,providerId:p.id,profiles,origin:new URL(p.base).origin,...result,updatedAt:new Date().toISOString()};
 }catch(e){const code=e instanceof BalanceError?e.code:'configuration';return{schemaVersion:1,mode:p?.mode||'api',activeMode,state:'error',provider:p?.name||null,providerId:p?.id||null,profiles,code,message:messages[code]||messages.configuration,updatedAt:null};}
}
const taskIdPattern=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validTaskPath(file,id){
 if(typeof file!=='string'||!taskIdPattern.test(id||''))return false;
 const value=file.replace(/\\/g,'/');
 return /^(?:[a-z]:\/|\/)/i.test(value)&&!value.split('/').includes('..')&&/\/(sessions|archived_sessions)\//i.test(value)&&value.toLowerCase().endsWith('-'+id.toLowerCase()+'.jsonl');
}
function tokenFields(v){return Object.fromEntries(['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'].map(k=>[k,positive(v?.[k])]));}
async function collectTask({taskPath,taskId}){
 const fail=code=>({schemaVersion:1,state:'task',threadId:taskId,available:false,code});
 if(!validTaskPath(taskPath,taskId))return fail('task_path');
 let handle;
 try{
  handle=await fs.open(taskPath,'r');const stat=await handle.stat();if(!stat.isFile())return fail('task_missing');
  const head=Buffer.alloc(Math.min(stat.size,512*1024));await handle.read(head,0,head.length,0);
  const first=json(head.toString('utf8').replace(/^\uFEFF/,'').split('\n')[0]);
  if(first?.type!=='session_meta'||typeof first.payload?.id!=='string'||first.payload.id.toLowerCase()!==taskId.toLowerCase())return fail('task_identity');
  let position=stat.size,scanned=0,carry=Buffer.alloc(0),skipLine=false,info=null,model=null,updatedAt=null;
  const inspect=line=>{
   if(line.length>2*1024*1024)return;
   const value=line.toString('utf8');if(!value.includes('token_count')&&!value.includes('turn_context'))return;
   const event=json(value);
   if(!model&&event?.type==='turn_context'&&typeof event.payload?.model==='string')model=event.payload.model.slice(0,128);
   const candidate=event?.type==='event_msg'&&event.payload?.type==='token_count'?event.payload.info:null;
   if(!info&&positive(candidate?.total_token_usage?.total_tokens)!==null){info={total_token_usage:tokenFields(candidate.total_token_usage),last_token_usage:tokenFields(candidate.last_token_usage),model_context_window:positive(candidate.model_context_window)};updatedAt=date(event.timestamp);}
  };
  while(position>0&&scanned<64*1024*1024){
   const length=Math.min(position,256*1024),block=Buffer.alloc(length);position-=length;
   const read=await handle.read(block,0,length,position);if(read.bytesRead!==length)return fail('task_changed');scanned+=length;
   let buffer=Buffer.concat([block,carry]);carry=Buffer.alloc(0);
   if(skipLine){const boundary=buffer.lastIndexOf(10);if(boundary<0)continue;buffer=buffer.subarray(0,boundary+1);skipLine=false;}
   let end=buffer.length;
   for(let newline=buffer.lastIndexOf(10,end-1);newline>=0;newline=end>0?buffer.lastIndexOf(10,end-1):-1){inspect(buffer.subarray(newline+1,end));end=newline;}
   if(position===0)inspect(buffer.subarray(0,end));else if(end>2*1024*1024)skipLine=true;else carry=Buffer.from(buffer.subarray(0,end));
   if(info&&(model||scanned>=1024*1024))break;
  }
  if(!info)return fail(position>0?'task_scan_limit':'task_empty');
  return{schemaVersion:1,state:'task',threadId:taskId,available:true,info,model,updatedAt,bytesRead:scanned};
 }catch(e){return fail(['ENOENT','ENOTDIR'].includes(e.code)?'task_missing':['EACCES','EPERM','ERR_ACCESS_DENIED'].includes(e.code)?'task_permission':'task_read');}
 finally{await handle?.close();}
}
module.exports={selectProfile,baseFromConfig,parseSub2api,parseNewApi,requestJson,query,collect,collectTask,validTaskPath};
if(require.main===module){
 const args=process.argv.slice(2),options={};let valid=true;
 if(args.length===1&&args[0]==='--self-test'){
  const ok=Number(process.versions.node.split('.')[0])>=24&&typeof fetch==='function'&&process.permission?.has('fs.read',__filename)&&!process.permission.has('fs.write')&&!process.permission.has('child');
  process.stdout.write(JSON.stringify({schemaVersion:1,state:ok?'self-test-ok':'runtime-error',node:process.versions.node}));if(!ok)process.exitCode=1;
 }else if(args[0]==='--task-id'&&args[2]==='--task-path'&&args.length===4){
  collectTask({taskId:args[1],taskPath:args[3]}).then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>{process.stdout.write(JSON.stringify({schemaVersion:1,state:'task',threadId:args[1],available:false,code:'task_read'}));process.exitCode=1;});
 }else{
  while(args.length){const key=args.shift(),value=args.shift();if(!value||!['--profile-id','--settings-path'].includes(key)){valid=false;break;}const name=key==='--profile-id'?'profileId':'settingsPath';if(options[name]){valid=false;break;}options[name]=value;}
  if(options.profileId&&!/^relay-[a-z0-9]+$/i.test(options.profileId))valid=false;
  if(options.settingsPath&&!path.isAbsolute(options.settingsPath))valid=false;
  if(!valid){process.stdout.write(JSON.stringify({schemaVersion:1,state:'error',code:'configuration',message:messages.configuration}));process.exitCode=1;}
  else collect(options).then(result=>process.stdout.write(JSON.stringify(result))).catch(()=>{process.stdout.write(JSON.stringify({schemaVersion:1,state:'error',code:'configuration',message:messages.configuration}));process.exitCode=1;});
 }
}
