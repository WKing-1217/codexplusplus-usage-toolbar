// Codex++ 用户脚本：顶部用量栏 v1.0.1
// Supports Codex 26.831.20005 / 26.901.20858 and Codex++ 1.2.56.
// Reads account limits and the exact local task only. Does not write app files.
(async () => {
  'use strict';
  const VERSION = '1.0.1';
  const HELPER = /*__HELPER__*/null;
  function collectorParams(helper,profile='') {
    if(!helper || !['node','script','cwd','settings'].every(k=>typeof helper[k]==='string' && helper[k].length>0) || !/^(?:relay-[a-z0-9]+)?$/i.test(profile))throw collectorFailure('installation');
    // Keep the host's configured sandbox. The collector separately denies file writes,
    // child processes and unrelated file reads through Node's permission model.
    const command=[helper.node,'--permission'];
    if(helper.allowNet===true)command.push('--allow-net');
    command.push('--allow-fs-read='+helper.script,'--allow-fs-read='+helper.settings,helper.script,'--settings-path',helper.settings);
    if(profile)command.push('--profile-id',profile);
    return {command,cwd:helper.cwd,env:{NODE_OPTIONS:null},timeoutMs:30000};
  }
  function collectorFailure(stage,detail='') {
    const raw=String(detail).slice(0,4096);let code=stage;
    if(/method not found|unsupported.*command|unknown variant/i.test(raw))code='unsupported';
    else if(/sandbox|restricted token|CreateProcessAsUser|LogonUser/i.test(raw))code='sandbox';
    else if(/ENOENT|cannot find|could not find|not found|找不到|系统找不到/i.test(raw))code='missing';
    else if(/EACCES|EPERM|access.denied|permission.denied|拒绝访问/i.test(raw))code='permission';
    else if(/timeout|timed out|超时/i.test(raw))code='timeout';
    else if(/bad option|unknown option|NODE_OPTIONS|not allowed in NODE_OPTIONS/i.test(raw))code='runtime';
    const messages={installation:'安装信息不完整，请重新双击 install.cmd 修复。',missing:'查询程序或运行目录不存在，请双击 install.cmd 修复后重新加载脚本。',permission:'系统拒绝启动或读取查询程序。请运行 diagnose.cmd 检查文件权限。',sandbox:'Codex 的 Windows 沙箱未就绪或拒绝执行。请在 Codex 中完成当前权限模式的设置，再刷新；插件不会修改权限设置。',timeout:'本机查询超时。请稍后刷新；持续失败时运行 diagnose.cmd 检查本机查询。',runtime:'Node 运行环境不兼容，请双击 install.cmd 修复。',unsupported:'当前 Codex 不支持查询命令，请更新到 README 中的兼容版本。',output:'查询程序没有返回完整数据。请运行 diagnose.cmd 检查安装。',exit:'查询程序异常退出。请运行 diagnose.cmd 检查安装。',rpc:'Codex 拒绝执行查询命令。请运行 diagnose.cmd；如果本机自检通过，请检查 Codex 当前权限设置。',bridge:'Codex 本机连接尚未就绪，请稍后刷新。'};
    const error=new Error(messages[code]||messages.rpc);error.code='collector_'+(Object.hasOwn(messages,code)?code:'rpc');return error;
  }
  function parseCollectorResult(result) {
    if(result?.exitCode!==0)throw collectorFailure(result?.exitCode===124?'timeout':'exit',result?.stderr);
    let value;try{value=JSON.parse(result.stdout);}catch{throw collectorFailure('output');}
    if(value?.schemaVersion!==1||!['ok','not-api','error'].includes(value.state))throw collectorFailure('output');
    return value;
  }
  // Exact modules and decoder exports verified against each installed archive.
  const ADAPTERS = Object.freeze({
    '26.831.20005': {module:'app://-/assets/app-initial-e2ba7feffc8d.js',decoder:'tZt'},
    '26.901.20858': {module:'app://-/assets/app-initial-bca8cba1737e.js',decoder:'vun'}
  });
  const ID = 'codex-plus-usage-toolbar';
  const MAX_BYTES = 16 * 1024 * 1024;
  const validId = id => typeof id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
  const numeric = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  const number = n => numeric(n) === null ? '—' : new Intl.NumberFormat('zh-CN').format(n);
  const short = n => numeric(n) === null ? '—' : new Intl.NumberFormat('en', {notation:'compact', maximumFractionDigits:1}).format(n);
  function threadFromPath(path) {
    const match = typeof path === 'string' && path.match(/^\/(?:local|hotkey-window\/thread)\/([^/?#]+)\/?$/);
    return match && validId(match[1]) ? match[1].toLowerCase() : null;
  }
  function validRollout(path, id) {
    if (!validId(id) || typeof path !== 'string') return false;
    const normalized = path.replace(/\\/g, '/');
    return /^(?:[a-z]:\/|\/)/i.test(normalized) && !normalized.split('/').includes('..') &&
      /\/(?:sessions|archived_sessions)\//i.test(normalized) &&
      normalized.toLowerCase().endsWith(`-${id.toLowerCase()}.jsonl`);
  }
  function windowInfo(w) {
    if (!w) return null;
    const used = numeric(w.usedPercent);
    return {remaining:used === null ? null : Math.max(0, Math.min(100, 100-used)), minutes:numeric(w.windowDurationMins), resetsAt:numeric(w.resetsAt)};
  }
  function normalizeAccount(account, limits) {
    const mode = account?.type === 'chatgpt' ? 'account' : account?.type === 'apiKey' ? 'api' : 'unknown';
    const quota = limits?.rateLimitsByLimitId ? limits.rateLimitsByLimitId.codex : limits?.rateLimits;
    return {mode, plan:account?.planType || null, primary:windowInfo(quota?.primary), secondary:windowInfo(quota?.secondary),
      resets:numeric(limits?.rateLimitResetCredits?.availableCount), updatedAt:Date.now(),
      warning:mode === 'account' && !quota ? '额度暂时不可用。' : mode === 'unknown' ? '未检测到本机登录。' : null};
  }
  function usageInfo(total, last, context, model, updatedAt) {
    const input=numeric(total?.input_tokens), cached=numeric(total?.cached_input_tokens), limit=numeric(context), used=numeric(last?.total_tokens);
    return {available:true, model:model || null, updatedAt:updatedAt || null, input, cached,
      fresh:input !== null && cached !== null && cached <= input ? input-cached : null,
      output:numeric(total?.output_tokens), reasoning:numeric(total?.reasoning_output_tokens), total:numeric(total?.total_tokens),
      context:limit, contextUsed:used, contextRemaining:limit !== null && used !== null ? Math.max(0,limit-used) : null,
      cachePercent:input > 0 && cached !== null && cached <= input ? cached/input*100 : null};
  }
  function parseSession(text) {
    let info, model, updatedAt;
    for (const line of text.split(/\r?\n/)) {
      let event; try { event=JSON.parse(line); } catch { continue; }
      if (event.type === 'turn_context' && typeof event.payload?.model === 'string') model=event.payload.model;
      if (event.type === 'event_msg' && event.payload?.type === 'token_count' && event.payload.info) { info=event.payload.info; updatedAt=event.timestamp; }
    }
    return info ? usageInfo(info.total_token_usage, info.last_token_usage, info.model_context_window, model, updatedAt)
      : {available:false, warning:'当前任务尚无 Token 用量记录。'};
  }
  function liveUsage(info) {
    const convert = v => v && ({input_tokens:v.inputTokens, cached_input_tokens:v.cachedInputTokens,
      output_tokens:v.outputTokens, reasoning_output_tokens:v.reasoningOutputTokens, total_tokens:v.totalTokens});
    return usageInfo(convert(info?.total), convert(info?.last), info?.modelContextWindow, null, new Date().toISOString());
  }
  function windowLabel(minutes) { return minutes === 10080 ? '周额度' : minutes == null ? '额度' : minutes < 60 ? `${minutes}分钟` : minutes < 1440 ? `${minutes/60}小时` : `${minutes/1440}天`; }
  function summary(a) {
    if (!a) return '正在读取额度';
    if (a.mode === 'api') return 'API 登录';
    if (a.mode !== 'account') return '额度暂不可用';
    const windows=[a.primary,a.secondary].filter(Boolean);
    return windows.length ? windows.map(w=>`${windowLabel(w.minutes)} ${w.remaining == null ? '—' : Math.round(w.remaining)+'%'}`).join(' · ') : '账号 · 额度不可用';
  }
  if (typeof module === 'object' && module.exports) {
    module.exports={ADAPTERS,threadFromPath,validRollout,normalizeAccount,parseSession,liveUsage,usageInfo,summary,collectorParams,collectorFailure,parseCollectorResult}; return;
  }
  // Production surface guard; never mount in websites or embedded browser tabs.
  if (window.top !== window || !window.electronBridge || !/^app:\/\/\-\//i.test(location.href)) return;
  const nativeVersion = window.electronBridge.getSentryInitOptions?.()?.appVersion;
  window.__codexPlusUsageToolbar?.dispose?.();
  function report(state,status,error='') {
    const changed=state.status!==status || state.error!==error;
    state.status=status;state.error=error;
    // Codex++ wraps scripts synchronously; publish after its wrapper completes.
    queueMicrotask(()=>{
      if(window.__codexPlusUsageToolbar!==state)return;
      const entry=window.__codexPlusUserScripts?.scripts?.['user:codex-usage-toolbar.js'];
      if(entry){entry.status=status==='mounted'||status==='existing-toolbar'?'loaded':status==='loading'||status==='waiting-for-header'?'loading':'failed';entry.error=error;}
      if(changed && typeof window.__codexSessionDeleteBridge==='function') {
        try{Promise.resolve(window.__codexSessionDeleteBridge('/diagnostics/log',{event:'usage_toolbar.status',detail:{version:VERSION,nativeVersion,status,error}})).catch(()=>{});}catch{}
      }
    });
  }
  const bootState={version:VERSION,actualVersion:nativeVersion || null,status:'starting',cancelled:false,dispose(){this.cancelled=true;}};
  window.__codexPlusUsageToolbar=bootState;
  const adapter=Object.hasOwn(ADAPTERS,nativeVersion)?ADAPTERS[nativeVersion]:null;
  if (!adapter) {
    report(bootState,'unsupported-version',`当前 Codex ${nativeVersion || '未知'} 尚未适配；请更新顶部栏脚本。`);return;
  }
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  if(bootState.cancelled || window.__codexPlusUsageToolbar!==bootState)return;
  if (document.querySelector('.uc-native-toolbar')) {report(bootState,'existing-toolbar');return;}
  // Use the app's own verified message decoder, including chunk reassembly.
  // A large rollout response must not be mistaken for an empty response.
  report(bootState,'loading');
  let decodeMessage;
  try {
    const nativeModule=await import(adapter.module);
    decodeMessage=nativeModule[adapter.decoder];
    if(typeof decodeMessage!=='function')throw new Error('No native decoder');
  }catch{report(bootState,'native-bridge-unavailable','无法加载当前版本的本地消息模块。');return;}
  if(bootState.cancelled || window.__codexPlusUsageToolbar!==bootState)return;
  const style=document.createElement('style'); style.id=ID+'-style'; style.textContent=/*__CSS__*/'';
  document.head.append(style);
  const root=document.createElement('div'); root.id=ID; root.className='uc-native-toolbar';
  const pending=new Map(), threadCache=new Map(), liveCache=new Map();
  let disposed=false, account=null, accountAt=0, accountBusy=false, taskBusy=false, currentId=null, conversation=null, placementQueued=false;
  let balance=null,balanceAt=0,balanceBusy=false,balanceGeneration=0,balanceProfile=HELPER?.defaultProfile || '';
  try{balanceProfile=localStorage.getItem(ID+'-balance-profile')??balanceProfile;}catch{}
  if(!/^(?:relay-[a-z0-9]+)?$/i.test(balanceProfile))balanceProfile='';
  let rootObserver, clockTimer, refreshTimer, routeTimer;
  const cleanupCallbacks=[];
  const api={version:VERSION,actualVersion:nativeVersion,status:'starting',dispose}; window.__codexPlusUsageToolbar=api;
  function listen(target,name,fn,options) { target.addEventListener(name,fn,options); cleanupCallbacks.push(()=>target.removeEventListener(name,fn,options)); }
  function dispose() {
    if (disposed) return; disposed=true; clearInterval(clockTimer);clearInterval(refreshTimer);clearTimeout(routeTimer);
    rootObserver?.disconnect(); cleanupCallbacks.forEach(f=>f());
    for (const p of pending.values()) { clearTimeout(p.timer);p.reject(new Error('Disposed')); } pending.clear();
    threadCache.clear();liveCache.clear();root.remove();style.remove();report(api,'stopped','顶部栏脚本已停止。');
  }
  function nativeRequest(kind,method,params) {
    const allowed = kind === 'rpc' ? ['account/read','account/rateLimits/read','thread/read','command/exec'] : ['read-file-metadata','read-file-binary'];
    if (!allowed.includes(method)) return Promise.reject(new Error('Unsupported read request'));
    if(method==='command/exec' && JSON.stringify(params)!==JSON.stringify(collectorParams(HELPER,balanceProfile)))return Promise.reject(collectorFailure('installation'));
    if (disposed) return Promise.reject(new Error('Disposed'));
    const id=`usage-toolbar:${crypto.randomUUID()}`;
    return new Promise((resolve,reject)=>{
      const timeout=method==='command/exec'?35000:10000;
      const timer=setTimeout(()=>{pending.delete(id);reject(method==='command/exec'?collectorFailure('timeout'):new Error('Read timeout'));},timeout);
      pending.set(id,{resolve,reject,timer,kind,method});
      const message=kind === 'rpc'
        ? {type:'mcp-request',hostId:'local',request:{id,method,params},priority:'background',timeoutMs:timeout-1000,expiresAtMs:Date.now()+timeout-1000}
        : {type:'fetch',requestId:id,method:'POST',url:`vscode://codex/${method}`,body:JSON.stringify({params})};
      Promise.resolve(window.electronBridge.sendMessageFromView(message)).catch(()=>{
        const p=pending.get(id);if(p){pending.delete(id);clearTimeout(timer);reject(method==='command/exec'?collectorFailure('bridge'):new Error('Local bridge unavailable'));}
      });
    });
  }
  listen(window,'message',event=>{
    if (event.source && event.source !== window) return;
    let m;try{m=decodeMessage(event);}catch{return;}if(!m || typeof m !== 'object') return;
    if(m.type==='mcp-notification'&&m.hostId==='local'&&['account/updated','account/rateLimits/updated'].includes(m.method)){
      account=null;accountAt=0;render();void refreshAccount();
    }
    if (m.type === 'mcp-notification' && m.hostId === 'local' && m.method === 'thread/tokenUsage/updated') {
      const id=m.params?.threadId;
      if(validId(id) && m.params?.tokenUsage) {
        liveCache.set(id.toLowerCase(),liveUsage(m.params.tokenUsage));
        if(liveCache.size>64)liveCache.delete(liveCache.keys().next().value);
        if(id.toLowerCase() === currentId){conversation=liveCache.get(currentId);render();}
      }
      return;
    }
    const id=m.type === 'mcp-response' && m.hostId === 'local' ? m.message?.id : m.type === 'fetch-response' ? m.requestId : null;
    const p=pending.get(id);if(!p)return;
    if((p.kind==='rpc' && m.type!=='mcp-response') || (p.kind==='fetch' && m.type!=='fetch-response'))return;
    pending.delete(id);clearTimeout(p.timer);
    if(p.kind==='rpc') {m.message.error ? p.reject(p.method==='command/exec'?collectorFailure('rpc',m.message.error.message):new Error('Read failed')) : p.resolve(m.message.result);}
    else if(m.responseType!=='success' || (m.status && m.status>=400))p.reject(new Error('File read failed'));
    else {try{p.resolve('body' in m ? m.body : JSON.parse(m.bodyJsonString || 'null'));}catch{p.reject(new Error('Invalid response'));}}
  });
  function currentPath() {
    const anchor=document.querySelector('[data-app-shell-header-toolbar]') || document.querySelector('[data-testid="app-shell-header-context-menu-surface"]');
    const key=anchor && Object.keys(anchor).find(k=>k.startsWith('__reactFiber$'));
    let fiber=key?anchor[key]:null;
    for(let depth=0;fiber && depth<80;depth++,fiber=fiber.return){
      let dep=fiber.dependencies?.firstContext;
      for(let count=0;dep && count<16;count++,dep=dep.next){
        const path=dep.memoizedValue?.location?.pathname;
        if(typeof path==='string' && path.startsWith('/'))return path;
      }
    }
    if(location.hash.startsWith('#/'))return location.hash.slice(1).split('?')[0];
    return location.pathname;
  }
  function checkRoute() {
    const id=threadFromPath(currentPath());
    if(id === currentId)return;
    currentId=id;conversation=null;try{panel.hidePopover();}catch{} render();schedulePlace();void refreshTask();
  }
  function fitPanel() {
    const rect=button.getBoundingClientRect(),margin=12;
    const width=Math.max(0,Math.min(380,innerWidth-24)),top=Math.max(margin,Math.min(rect.bottom+8,innerHeight-margin));
    Object.assign(panel.style,{width:width+'px',left:Math.max(margin,Math.min(rect.right-width,innerWidth-width-margin))+'px',top:top+'px',maxHeight:Math.max(0,Math.min(520,innerHeight*.66,innerHeight-top-margin))+'px'});
  }
  function place() {
    if(disposed)return;
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0 && r.height>0 && r.top>=0 && r.top<160 && !e.closest('[aria-hidden="true"]') && getComputedStyle(e).visibility!=='hidden';};
    const toolbars=[...document.querySelectorAll('[data-app-shell-header-toolbar]')];
    const toolbar=toolbars.find(visible);
    const shell=[...document.querySelectorAll('[data-testid="app-shell-header-context-menu-surface"]')].find(visible);
    const host=toolbar?.querySelector(':scope > .ms-auto') || toolbar || shell?.querySelector(':scope > .ms-auto[data-app-shell-header-obstacle]') || shell;
    if(host){
      root.dataset.shellFallback=String(!toolbar);
      if(root.parentElement!==host){if(host===shell)host.append(root);else host.prepend(root);}
      report(api,'mounted');
    } else {root.remove();report(api,'waiting-for-header','等待 Codex 顶部区域就绪。');}
    checkRoute();if(panel.matches(':popover-open'))fitPanel();
  }
  function schedulePlace(){if(placementQueued||disposed)return;placementQueued=true;routeTimer=setTimeout(()=>{placementQueued=false;place();},100);}
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const button=el('button','uc-trigger');button.type='button';button.setAttribute('aria-controls',ID+'-details');button.setAttribute('aria-expanded','false');
  const dot=el('span','uc-dot'),summaryNode=el('span','uc-summary'),balanceHint=el('span','uc-token-hint'),tokenNode=el('span','uc-token-hint'),clock=el('time','uc-clock'),chevron=el('span','uc-chevron','⌄');
  balanceHint.classList.add('uc-balance-hint');
  tokenNode.classList.add('uc-conversation-tokens');
  button.append(dot,summaryNode,balanceHint,tokenNode,clock,chevron);
  const panel=el('section','uc-panel');panel.id=ID+'-details';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','用量详情');
  const heading=el('header','uc-heading'),headingText=el('div');headingText.append(el('span','uc-kicker','CODEX++ · 1.0'),el('strong',null,'用量详情'),el('small',null,'账号额度 · API 余额 · 当前任务'));
  const close=el('button',null,'收起 ×');close.type='button';close.setAttribute('aria-label','收起用量详情');heading.append(headingText,close);
  const body=el('div','uc-panel-body');body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-label','用量详情可滚动内容');
  const balanceControls=el('div','uc-balance-controls'),balanceSelect=el('select');balanceSelect.setAttribute('aria-label','查询哪个 API 余额账户');
  const balanceLabel=el('label',null,'余额账户');balanceSelect.id=ID+'-balance-profile';balanceLabel.htmlFor=balanceSelect.id;
  const refresh=el('button','uc-refresh','立即刷新');refresh.type='button';
  balanceControls.append(balanceLabel,balanceSelect,refresh);
  let profilesSignature='';
  function updateProfiles(profiles=[]){
    const signature=JSON.stringify([balanceProfile,profiles]);if(signature===profilesSignature)return;profilesSignature=signature;
    balanceSelect.replaceChildren();const auto=el('option',null,'跟随 Codex++');auto.value='';balanceSelect.append(auto);
    for(const p of profiles){if(!/^relay-[a-z0-9]+$/i.test(p.id)||typeof p.name!=='string')continue;const option=el('option',null,p.name);option.value=p.id;balanceSelect.append(option);}
    if(balanceProfile && !profiles.some(p=>p.id===balanceProfile)){const option=el('option',null,'已选择的 API 账户');option.value=balanceProfile;balanceSelect.append(option);}
    balanceSelect.value=balanceProfile;
  }
  listen(balanceSelect,'change',()=>{balanceProfile=balanceSelect.value;try{localStorage.setItem(ID+'-balance-profile',balanceProfile);}catch{}balanceGeneration++;balance=null;balanceAt=0;render();void refreshBalance();});
  listen(refresh,'click',()=>{accountAt=0;balanceAt=0;void refreshAccount();void refreshBalance();void refreshTask();});
  const footer=el('footer');panel.append(heading,body,footer);root.append(button,panel);
  listen(button,'click',()=>{fitPanel();panel.togglePopover();});
  listen(close,'click',()=>{panel.hidePopover();button.focus();});
  listen(panel,'beforetoggle',e=>{button.setAttribute('aria-expanded',String(e.newState==='open'));if(e.newState==='open')fitPanel();});
  listen(window,'resize',()=>{place();});
  listen(window,'wheel',event=>{
    if(!panel.matches(':popover-open') || !event.composedPath().includes(panel))return;
    event.stopImmediatePropagation();if(event.ctrlKey || !event.cancelable)return;
    event.preventDefault();const unit=event.deltaMode===1?18:event.deltaMode===2?body.clientHeight:1;
    body.scrollTop=Math.max(0,Math.min(body.scrollHeight-body.clientHeight,body.scrollTop+event.deltaY*unit));
  },{capture:true,passive:false});
  const row=(label,value,note)=>{const n=el('div','uc-row'),l=el('span',null,label);if(note)l.append(el('small',null,note));n.append(l,el('strong',null,value));return n;};
  const amount=(value,b)=>typeof value!=='number'||!Number.isFinite(value)?'—':b?.currency?new Intl.NumberFormat('zh-CN',{style:'currency',currency:b.currency,maximumFractionDigits:4}).format(value):number(value)+' '+(b?.unit||'额度单位');
  function balanceTitle(b){
    if(!b)return '余额查询中';
    if(b.state==='not-api')return 'ChatGPT 登录';
    if(b.state!=='ok')return b.code==='changed'?'账户切换中':'余额查询失败';
    if(b.plan?.state==='expired')return b.plan.name+' · 已到期';
    return (b.plan?.name || b.kind || '余额')+' · '+(b.unlimited?'不限额':amount(b.remaining,b));
  }
  function render(){
    if(disposed)return;
    const c=threadFromPath(currentPath())===currentId?conversation:null,a=account,title=summary(a);
    summaryNode.textContent=a?.mode==='api'?balanceTitle(balance):title;tokenNode.textContent=c?.available?short(c.total)+' Token':'';tokenNode.hidden=!c?.available;
    balanceHint.textContent=balanceTitle(balance);balanceHint.hidden=a?.mode==='api'||!balanceProfile;
    button.setAttribute('aria-label',title+'，展开或收起用量详情');dot.dataset.warning=String(Boolean(a?.warning||balance?.state==='error'));
    const scroll=body.scrollTop;body.replaceChildren();
    const mode=el('div','uc-account',a?.mode==='account'?`ChatGPT${a.plan?' · '+a.plan:''}`:a?.mode==='api'?'API 登录':'正在检查登录方式');mode.append(el('span',null,'只读'));body.append(mode);
    if(a?.warning)body.append(el('p','uc-warning',a.warning));
    if(a?.mode==='account'){
      for(const w of [a.primary,a.secondary].filter(Boolean)){
        const q=el('div','uc-quota');q.append(row(windowLabel(w.minutes),w.remaining==null?'—':Math.round(w.remaining)+'% 剩余'));
        if(w.remaining!==null){const track=el('div','uc-track'),bar=el('div');bar.style.width=w.remaining+'%';bar.dataset.low=String(w.remaining<20);track.append(bar);q.append(track);}
        q.append(el('small',null,w.resetsAt==null?'重置时间不可用':new Date(w.resetsAt*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 重置'));body.append(q);
      }
      body.append(row('可用重置次数',number(a.resets)));
    }
    body.append(el('h3',null,'API 余额'));
    updateProfiles(balance?.profiles);refresh.disabled=balanceBusy||accountBusy;refresh.textContent=refresh.disabled?'查询中…':'立即刷新';body.append(balanceControls);
    body.append(el('p','uc-note','只切换查询账户，不改变 Codex++ 供应商或当前对话。'));
    if(balance?.provider)body.append(row('服务商',balance.provider));
    if(balance?.state==='ok'){
      body.append(row(balance.kind,balance.unlimited?'无限额度':amount(balance.remaining,balance)));
      if(balance.plan){
        body.append(row('套餐名称',balance.plan.name),row('套餐状态',balance.plan.state==='expired'?'已到期':balance.plan.state==='active'?'有效':'详情未返回'));
      }
      if(balance.warning)body.append(el('p','uc-warning',balance.warning));
      if(balance.limit!==null)body.append(row('密钥总额度',amount(balance.limit,balance)));
      if(balance.used!==null)body.append(row('密钥已用额度',amount(balance.used,balance)));
      for(const w of balance.windows||[])body.append(row(w.label+' 剩余',amount(w.remaining,balance),w.resetsAt?new Date(w.resetsAt).toLocaleString('zh-CN')+' 重置':null));
      if(balance.todaySpent!==null)body.append(row('此密钥今日扣费',amount(balance.todaySpent,balance),'服务商实际扣费，不等同于当前任务费用'));
      if(balance.totalSpent!==null)body.append(row('此密钥累计扣费',amount(balance.totalSpent,balance)));
      if(balance.todayRequests!==null)body.append(row('此密钥今日请求',number(balance.todayRequests)));
      if(balance.expiresAt)body.append(row('到期时间',new Date(balance.expiresAt).toLocaleString('zh-CN')));
      if(balance.currency===null)body.append(el('p','uc-note','服务商仅返回内部额度单位，未擅自换算为美元。'));
      body.append(el('p','uc-note','数据来源：'+balance.origin+' · '+balance.adapter));
    }else body.append(el('p',balance?.state==='error'?'uc-warning':'uc-note',balance?.message || (balance?.state==='not-api'?'当前是 ChatGPT 登录；可在上方选择已保存的 API 账户查询余额。':'正在读取服务商余额…')));
    body.append(el('h3',null,'当前任务 Token'));
    if(c?.available){
      const total=el('div','uc-total');total.append(el('small',null,'SESSION TOKENS'),document.createTextNode(number(c.total)),el('span',null,'累计 Token'));body.append(total);
      const metrics=el('div','uc-metrics');metrics.append(row('输入',number(c.input),'包含缓存读取'),row('缓存读取',number(c.cached)),row('非缓存输入',number(c.fresh),'不等同于缓存写入计费量'),row('输出',number(c.output)),row('其中推理',number(c.reasoning),'已包含在输出内'),row('缓存命中率',c.cachePercent==null?'—':c.cachePercent.toFixed(1)+'%'),row('上下文剩余估计',number(c.contextRemaining),'按最近一次请求；不是账号额度'));body.append(metrics);
      body.append(el('p','uc-note','缓存写入：当前日志未单独提供。'+(c.model?' 模型：'+c.model:'')));
    } else body.append(el('p','uc-note',c?.warning || (currentId?'正在读取当前任务记录…':'打开本机任务后显示 Token；远程任务不会借用本机其他记录。')));
    footer.textContent=VERSION+' · 任务 5 秒 · 额度/余额 60 秒';if(a?.updatedAt)footer.append(el('small',null,'账号更新 '+new Date(a.updatedAt).toLocaleTimeString('zh-CN')));
    if(balance?.updatedAt)footer.append(el('small',null,'余额更新 '+new Date(balance.updatedAt).toLocaleTimeString('zh-CN')));
    body.scrollTop=scroll;
  }
  async function refreshBalance(){
    if(disposed||document.hidden||balanceBusy||Date.now()-balanceAt<60000)return;
    const generation=balanceGeneration;balanceBusy=true;render();
    try{
      const result=await nativeRequest('rpc','command/exec',collectorParams(HELPER,balanceProfile));
      const value=parseCollectorResult(result);
      if(!disposed&&generation===balanceGeneration)balance=value;
    }catch(e){if(!disposed&&generation===balanceGeneration){const failure=e?.code?.startsWith('collector_')?e:collectorFailure('rpc');balance={state:'error',code:failure.code,message:failure.message+'（'+failure.code+'）'};}}
    finally{balanceBusy=false;if(generation===balanceGeneration)balanceAt=Date.now();render();if(!disposed&&generation!==balanceGeneration)void refreshBalance();}
  }
  async function refreshAccount(){
    if(disposed||document.hidden||accountBusy||Date.now()-accountAt<60000)return;
    accountBusy=true;
    try{
      const read=await nativeRequest('rpc','account/read',{refreshToken:false});
      let limits;if(read?.account?.type==='chatgpt'){try{limits=await nativeRequest('rpc','account/rateLimits/read',{});}catch{}}
      if(!disposed)account=normalizeAccount(read?.account,limits);
    }catch{if(!disposed)account={mode:'unknown',warning:'本机账号信息读取失败，稍后自动重试。',updatedAt:null};}
    finally{accountAt=Date.now();accountBusy=false;render();}
  }
  async function readTask(id){
    if(!id)return{available:false,warning:'打开本机任务后显示 Token。'};
    let cached=threadCache.get(id);
    if(!cached || Date.now()-cached.pathAt>60000){
      const response=await nativeRequest('rpc','thread/read',{threadId:id,includeTurns:false});
      if(response?.thread?.id?.toLowerCase()!==id || !validRollout(response.thread.path,id))throw new Error('No exact local rollout');
      cached={path:response.thread.path,pathAt:Date.now()};threadCache.set(id,cached);
      if(threadCache.size>64)threadCache.delete(threadCache.keys().next().value);
    }
    const live=liveCache.get(id);
    const metadata=await nativeRequest('fetch','read-file-metadata',{path:cached.path,hostId:'local'});
    if(!metadata?.isFile || numeric(metadata.sizeBytes)===null)throw new Error('No local file');
    if(metadata.sizeBytes>MAX_BYTES)return live || {available:false,warning:'当前任务日志超过 16 MiB；等待该任务下一次实时用量更新。'};
    if(cached.value && cached.size===metadata.sizeBytes && cached.mtime===metadata.mtimeMs){return newest(cached.value,live);}
    const result=await nativeRequest('fetch','read-file-binary',{path:cached.path,hostId:'local',maxBytes:MAX_BYTES});
    if(typeof result?.contentsBase64!=='string')return live || {available:false,warning:'当前记录超过读取上限；等待实时用量更新。'};
    const bytes=Uint8Array.from(atob(result.contentsBase64),c=>c.charCodeAt(0));
    cached.value=parseSession(new TextDecoder().decode(bytes));cached.size=metadata.sizeBytes;cached.mtime=metadata.mtimeMs;
    return newest(cached.value,liveCache.get(id));
  }
  function newest(file,live){return live && (!file.available || Date.parse(live.updatedAt)>Date.parse(file.updatedAt || 0)) ? {...live,model:file.model||null} : file;}
  async function refreshTask(){
    if(disposed||document.hidden||taskBusy)return;
    const id=currentId;taskBusy=true;
    try{const value=await readTask(id);if(!disposed && id===currentId && threadFromPath(currentPath())===id){conversation=value;render();}}
    catch{if(!disposed && id===currentId){conversation=liveCache.get(id) || {available:false,warning:'未能读取这个任务的本机记录；远程任务暂不支持。'};render();}}
    finally{taskBusy=false;if(!disposed && id!==currentId)void refreshTask();}
  }
  function tick(){
    if(disposed||document.hidden)return;checkRoute();const date=new Date();clock.textContent=date.toLocaleTimeString('zh-CN',{hour12:false});clock.dateTime=date.toISOString();
  }
  listen(window,'popstate',checkRoute);listen(window,'hashchange',checkRoute);
  listen(document,'visibilitychange',()=>{if(!document.hidden){place();tick();void refreshAccount();void refreshBalance();void refreshTask();}});
  rootObserver=new MutationObserver(records=>{if(records.some(r=>!root.contains(r.target) && r.target!==style))schedulePlace();});
  rootObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-app-shell-header-toolbar','aria-hidden']});
  clockTimer=setInterval(tick,1000);refreshTimer=setInterval(()=>{void refreshAccount();void refreshBalance();void refreshTask();},5000);
  place();render();tick();void refreshAccount();void refreshBalance();void refreshTask();
})().catch(()=>{
  const state=window.__codexPlusUsageToolbar;
  if(state){state.dispose?.();state.status='failed';state.error='顶部栏初始化失败；请检查当前脚本版本。';}
  queueMicrotask(()=>{const entry=window.__codexPlusUserScripts?.scripts?.['user:codex-usage-toolbar.js'];if(entry){entry.status='failed';entry.error=state?.error || '顶部栏初始化失败';}});
});
