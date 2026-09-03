// Codex++ 用户脚本：顶部用量栏 v1.0.6
// Supports Codex 26.831.20005 / 26.901.20858 and Codex++ 1.2.56.
// Reads the active API balance and exact local task only. Does not write app files.
(async () => {
  'use strict';
  const VERSION = '1.0.6';
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
    else if(/CreateProcessAsUser(?:W)?[^\n]*failed:\s*5(?:\D|$)/i.test(raw))code='runtime_access';
    else if(/sandbox|restricted token|CreateProcessAsUser|LogonUser/i.test(raw))code='sandbox';
    else if(/ENOENT|cannot find|could not find|not found|找不到|系统找不到/i.test(raw))code='missing';
    else if(/EACCES|EPERM|access.denied|permission.denied|拒绝访问/i.test(raw))code='permission';
    else if(/timeout|timed out|超时/i.test(raw))code='timeout';
    else if(/bad option|unknown option|NODE_OPTIONS|not allowed in NODE_OPTIONS/i.test(raw))code='runtime';
    const messages={installation:'安装信息不完整，请重新双击 install.cmd 修复。',missing:'查询程序或运行目录不存在，请双击 install.cmd 修复后重新加载脚本。',permission:'系统拒绝启动或读取查询程序。请运行 diagnose.cmd 检查文件权限。',runtime_access:'Windows 拒绝沙箱进程启动查询程序。请双击 repair.cmd 或开始菜单的“Codex++ 用量栏修复”，然后刷新；若仍失败，请运行 diagnose.cmd。',sandbox:'Codex 的 Windows 沙箱尚未就绪或拒绝执行。请先在 Codex 设置中完成沙箱配置，再运行 repair.cmd 并刷新。当前对话的完全访问权限不能代替查询进程的文件权限。',timeout:'本机查询超时。请稍后刷新；持续失败时运行 diagnose.cmd 检查本机查询。',runtime:'Node 运行环境不兼容，请双击 install.cmd 修复。',unsupported:'当前 Codex 不支持查询命令，请更新到 README 中的兼容版本。',output:'查询程序没有返回完整数据。请运行 diagnose.cmd 检查安装。',exit:'查询程序异常退出。请运行 diagnose.cmd 检查安装。',rpc:'Codex 拒绝执行查询命令。请运行 diagnose.cmd；如果本机自检通过，请检查 Codex 当前权限设置。',bridge:'Codex 本机连接尚未就绪，请稍后刷新。'};
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
  function normalizeTaskPath(path){
    return typeof path==='string'?path.replace(/^\\\\\?\\(?=[a-z]:\\)/i,'').replace(/^\\\\\?\\UNC\\/i,'\\\\'):path;
  }
  function taskParams(helper,id,path){
    path=normalizeTaskPath(path);
    if(!helper||!['node','script','cwd'].every(k=>typeof helper[k]==='string'&&helper[k])||!validRollout(path,id))throw taskFailure('task_path');
    return {command:[helper.node,'--permission','--allow-fs-read='+helper.script,'--allow-fs-read='+path,helper.script,'--task-id',id,'--task-path',path],cwd:helper.cwd,env:{NODE_OPTIONS:null},timeoutMs:20000};
  }
  function taskFailure(code){
    const messages={task_thread:'未能读取当前任务信息，请稍后点击“刷新 Token”。',task_path:'当前任务未返回匹配的本机日志；如果这是远程任务，暂不支持读取。',task_missing:'当前任务日志已移动或尚未写入，正在重新查找。',task_permission:'系统拒绝读取当前任务日志。请检查该任务日志的读取权限；无需切换余额账户。',task_identity:'任务日志身份不匹配，已停止读取，避免显示其他任务的 Token。',task_changed:'当前任务日志正在变化，稍后自动重试。',task_read:'当前任务日志读取失败，请点击“刷新 Token”重试。',task_output:'Token 查询程序返回的数据不完整，请更新插件后重新加载脚本。',task_scan_limit:'最近 64 MiB 日志未找到 Token 记录，等待当前任务下一次用量更新。',task_empty:'当前任务尚无 Token 用量记录。'};
    const error=new Error(messages[code]||messages.task_read);error.code=Object.hasOwn(messages,code)?code:'task_read';return error;
  }
  function parseTaskResult(result,id){
    if(result?.exitCode!==0)throw collectorFailure(result?.exitCode===124?'timeout':'exit',result?.stderr);
    let value;try{value=JSON.parse(result.stdout);}catch{throw taskFailure('task_output');}
    if(value?.schemaVersion!==1||value.state!=='task'||value.threadId?.toLowerCase()!==id)throw taskFailure('task_identity');
    if(!value.available){if(value.code==='task_empty')return{available:false,warning:taskFailure(value.code).message,code:value.code};throw taskFailure(value.code);}
    if(numeric(value.info?.total_token_usage?.total_tokens)===null)throw taskFailure('task_output');
    return usageInfo(value.info.total_token_usage,value.info.last_token_usage,value.info.model_context_window,value.model,value.updatedAt);
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
    if(numeric(info?.total?.totalTokens)===null)return{available:false};
    return usageInfo(convert(info?.total), convert(info?.last), info?.modelContextWindow, null, new Date().toISOString());
  }
  function isApiUsage(balance){return balance?.mode==='api'&&(balance.activeMode??balance.mode)==='api'&&balance?.state!=='not-api';}
  if (typeof module === 'object' && module.exports) {
    module.exports={ADAPTERS,threadFromPath,validRollout,parseSession,liveUsage,usageInfo,isApiUsage,collectorParams,collectorFailure,parseCollectorResult,taskParams,taskFailure,parseTaskResult,normalizeTaskPath}; return;
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
  const style=document.createElement('style'); style.id=ID+'-style'; style.textContent=".uc-native-toolbar { display:flex; align-items:center; flex:0 1 auto; min-width:0; -webkit-app-region:no-drag; font:12px/1.5 system-ui,\"Microsoft YaHei\",sans-serif; }\n.uc-native-toolbar { --uc-bg:#f9fcff; --uc-text:#183347; --uc-muted:#597084; --uc-line:#d9e8f0; --uc-soft:#edf6fb; --uc-green:#078e8b; --uc-accent:#087fa9; --uc-blue:#436fe0; --uc-edge:#a9d9e7; --uc-grid:#198cad0a; --uc-mono:ui-monospace,\"Cascadia Code\",Consolas,monospace; }\n.electron-dark .uc-native-toolbar { --uc-bg:#111d2a; --uc-text:#e2f3ff; --uc-muted:#98b1c5; --uc-line:#294353; --uc-soft:#192c3d; --uc-green:#4bdfc8; --uc-accent:#6bdcff; --uc-blue:#9caeff; --uc-edge:#35677e; --uc-grid:#6bdcff08; }\n.uc-trigger { border:1px solid var(--uc-edge); background:linear-gradient(115deg,var(--uc-bg),var(--uc-soft)); color:var(--uc-text); border-radius:9px; min-height:30px; padding:4px 10px; display:flex; align-items:center; gap:8px; cursor:pointer; font:inherit; white-space:nowrap; max-width:440px; min-width:0; box-shadow:inset 0 1px 0 #ffffff20,0 2px 9px #058fab0a; transition:border-color .15s,box-shadow .15s; }\n.uc-trigger:hover,.uc-trigger[aria-expanded=\"true\"] { border-color:var(--uc-accent); box-shadow:0 0 0 2px #08a7d011,0 3px 14px #058fab14; }\n.uc-trigger:focus-visible,.uc-panel button:focus-visible,.uc-panel-body:focus-visible { outline:2px solid var(--uc-accent); outline-offset:2px; }\n.uc-panel-body:focus-visible { outline-offset:-3px; }\n.uc-dot { width:6px; height:6px; border-radius:2px; transform:rotate(45deg); background:var(--uc-green); box-shadow:0 0 7px #06b7ba44; flex-shrink:0; }\n.uc-dot[data-warning=\"true\"] { background:#c79237; }\n.uc-summary { display:flex; align-items:center; gap:7px; min-width:0; overflow:hidden; font-weight:550; }\n.uc-summary-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.uc-plan-badge { display:inline-block; box-sizing:border-box; padding:1px 9px; border:1px solid #b58b27; border-radius:999px; background:linear-gradient(105deg,#fff0b0aa,transparent 35%,#fff5c080 49%,transparent 65%),linear-gradient(180deg,#fff2b4 0%,#f5d46f 43%,#d8a638 51%,#efc65b 100%); color:#553806; box-shadow:inset 0 1px 0 #fffbe1,inset 0 -1px 0 #a5722480,0 1px 3px #88601424; font:750 10px/1.5 system-ui,\"Microsoft YaHei\",sans-serif; letter-spacing:.45px; text-transform:uppercase; text-shadow:0 1px 0 #fff0a9b3; }\n.uc-summary .uc-plan-badge { flex:0 1 auto; min-width:28px; max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }\n.uc-plan-badge[data-state=\"expired\"] { filter:saturate(.45); }\n.uc-plan-row { align-items:center; }\n.uc-plan-row .uc-plan-badge { max-width:70%; white-space:normal; overflow-wrap:anywhere; text-align:center; }\n.electron-dark .uc-plan-badge { border-color:#d5aa48; box-shadow:inset 0 1px 0 #fff9db,inset 0 -1px 0 #80551480,0 1px 7px #dba83c26; }\n.uc-token-hint,.uc-clock { color:var(--uc-muted); border-left:1px solid var(--uc-line); padding-left:8px; font-size:11px; flex-shrink:0; }\n.uc-clock { font-variant-numeric:tabular-nums; font-family:var(--uc-mono); color:var(--uc-accent); letter-spacing:.2px; }\n.uc-chevron { color:var(--uc-muted); flex-shrink:0; transition:transform .15s; }\n.uc-trigger[aria-expanded=\"true\"] .uc-chevron { transform:rotate(180deg); }\n.uc-panel { position:fixed; inset:auto; margin:0; width:380px; max-width:calc(100vw - 24px); max-height:min(520px,66vh); padding:0; box-sizing:border-box; border:1px solid var(--uc-edge); border-radius:14px; background:var(--uc-bg); color:var(--uc-text); box-shadow:0 16px 48px #102e4930,0 0 0 3px #08a7d008,inset 0 1px 0 #ffffff20; overflow:hidden; text-align:left; font:12px/1.5 system-ui,\"Microsoft YaHei\",sans-serif; -webkit-app-region:no-drag; overscroll-behavior:none; pointer-events:auto; }\n.uc-panel:popover-open { display:flex; flex-direction:column; }\n.uc-panel-body { flex:1 1 auto; min-height:0; padding:4px 16px 6px; overflow-y:auto; overscroll-behavior:none; scrollbar-width:thin; scrollbar-color:var(--uc-edge) transparent; scrollbar-gutter:stable; touch-action:pan-y; }\n.uc-panel::backdrop { background:transparent; }\n.uc-heading { display:flex; justify-content:space-between; align-items:center; min-height:84px; box-sizing:border-box; padding:18px; flex-shrink:0; gap:12px; border-top:2px solid var(--uc-accent); border-bottom:1px solid var(--uc-line); background-image:linear-gradient(var(--uc-grid) 1px,transparent 1px),linear-gradient(90deg,var(--uc-grid) 1px,transparent 1px),linear-gradient(110deg,var(--uc-soft),var(--uc-bg)); background-size:16px 16px,16px 16px,100% 100%; }\n.uc-heading strong { display:block; font-size:26px; line-height:1.25; font-weight:700; letter-spacing:-.5px; }\n.uc-panel footer small { display:block; color:var(--uc-muted); font-size:11px; margin-top:2px; }\n.uc-heading button { flex-shrink:0; min-height:34px; box-sizing:border-box; border:1px solid var(--uc-edge); border-radius:7px; background:var(--uc-bg); color:var(--uc-text); cursor:pointer; font:13px/1.5 system-ui; padding:6px 11px; display:flex; align-items:center; justify-content:center; gap:7px; white-space:nowrap; }\n.uc-heading button:hover { border-color:var(--uc-accent); color:var(--uc-accent); }\n.uc-heading button span { font-size:17px; line-height:1; color:var(--uc-muted); }\n.uc-account { display:flex; align-items:center; justify-content:space-between; color:var(--uc-muted); font-size:11px; margin:10px 0; }\n.uc-account span { font-size:10px; border:1px solid var(--uc-edge); color:var(--uc-accent); border-radius:4px; padding:1px 5px; }\n.uc-quota { margin:12px 0; padding:10px 12px; border:1px solid var(--uc-line); border-radius:9px; background:linear-gradient(115deg,var(--uc-soft),var(--uc-bg)); }\n.uc-quota .uc-row { margin:0 0 8px; }\n.uc-row { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:9px 0; }\n.uc-row strong { font:550 12px/1.5 var(--uc-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }\n.uc-row small { display:block; color:var(--uc-muted); font-size:10px; }\n.uc-track { height:6px; border-radius:3px; background:var(--uc-line); overflow:hidden; margin:7px 0 7px; }\n.uc-track>div { height:100%; background:linear-gradient(90deg,var(--uc-green),var(--uc-accent),var(--uc-blue)); border-radius:3px; transition:width .2s; box-shadow:0 0 8px #09a7c83d; }\n.uc-track>div[data-low=\"true\"] { background:#ce8b35; }\n.uc-quota>small { color:var(--uc-muted); font-size:11px; }\n.uc-reset { width:100%; padding:7px; background:var(--uc-soft); color:var(--uc-muted); border:1px solid var(--uc-line); border-radius:7px; margin:4px 0 2px; cursor:not-allowed; font:inherit; }\n.uc-section-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:14px; border-top:1px solid var(--uc-line); margin:16px 0 12px; }\n.uc-section-heading:first-child { border-top:0; margin-top:0; padding-top:10px; }\n.uc-panel h3 { min-width:0; font-size:15px; font-weight:650; margin:0; display:flex; align-items:center; gap:7px; }\n.uc-panel h3::before { content:\"\"; flex-shrink:0; width:3px; height:15px; border-radius:2px; background:var(--uc-accent); }\n.uc-total { font:600 28px/1.4 var(--uc-mono); letter-spacing:-.8px; margin-bottom:12px; font-variant-numeric:tabular-nums; padding:14px; border:1px solid var(--uc-edge); border-radius:9px; color:var(--uc-accent); background:radial-gradient(ellipse at top right,#07bdd91c,transparent 75%),var(--uc-soft); }\n.uc-total small { display:block; font:9px/1.5 var(--uc-mono); letter-spacing:1.2px; margin-bottom:4px; color:var(--uc-muted); }\n.uc-total span { font:10px/1.5 system-ui; letter-spacing:0; margin-left:8px; color:var(--uc-muted); }\n.uc-metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-auto-rows:1fr; gap:10px; }\n.uc-metrics .uc-row { min-width:0; min-height:104px; box-sizing:border-box; display:flex; flex-direction:column; align-items:stretch; justify-content:space-between; gap:12px; margin:0; padding:12px 14px; border:1px solid var(--uc-line); border-radius:9px; background:var(--uc-bg); }\n.uc-metrics .uc-row>span { font-size:13px; font-weight:550; color:var(--uc-text); }\n.uc-metrics .uc-row small { font-size:11px; font-weight:400; margin-top:3px; }\n.uc-metrics .uc-row strong { font-size:20px; line-height:1.25; letter-spacing:-.4px; color:var(--uc-text); overflow-wrap:anywhere; white-space:normal; }\n.uc-metrics .uc-row:last-child { grid-column:1/-1; }\n.uc-note,.uc-warning { font-size:11px; line-height:1.6; margin:10px 0; }\n.uc-note { color:var(--uc-muted); }\n.uc-warning { color:#af792c; }\n.uc-panel footer { margin:0; padding:9px 18px 10px; border-top:1px solid var(--uc-line); background:var(--uc-soft); color:var(--uc-muted); font-size:9px; flex-shrink:0; }\n.uc-footer-label { font:8px/1.5 var(--uc-mono); color:var(--uc-accent); letter-spacing:.6px; margin-right:8px; }\n@media(max-width:1200px) { .uc-token-hint { display:none; } .uc-trigger { max-width:315px; } }\n@media(max-width:850px) { .uc-trigger { max-width:240px; gap:5px; padding:4px 7px; } .uc-clock { padding-left:5px; } }\n@media(prefers-reduced-motion:reduce) { .uc-track>div,.uc-chevron,.uc-trigger { transition:none; } }\n\n#codex-plus-usage-toolbar{margin-inline:8px;flex-shrink:1;pointer-events:auto}#codex-plus-usage-toolbar[data-shell-fallback=\"true\"]{margin-inline-start:auto}#codex-plus-usage-toolbar [hidden]{display:none!important}\n.uc-refresh { flex-shrink:0; color:var(--uc-text); background:var(--uc-soft); border:1px solid var(--uc-edge); border-radius:6px; padding:5px 9px; font:inherit; line-height:1.5; white-space:nowrap; cursor:pointer; }\n.uc-refresh:hover:not(:disabled) { color:var(--uc-accent); border-color:var(--uc-accent); }\n.uc-refresh:disabled { opacity:.6; cursor:wait; }\n";
  document.head.append(style);
  const root=document.createElement('div'); root.id=ID; root.className='uc-native-toolbar';
  const pending=new Map(), threadCache=new Map(), liveCache=new Map();
  let disposed=false, taskBusy=false, currentId=null, conversation=null, placementQueued=false;
  // Always follow the active provider, including upgrades with an old saved selection.
  const balanceProfile='';
  let balance=null,balanceAt=0,balanceBusy=false;
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
    const allowed = kind === 'rpc' ? ['thread/read','command/exec'] : ['read-file-metadata','read-file-binary'];
    if (!allowed.includes(method)) return Promise.reject(new Error('Unsupported read request'));
    if(method==='command/exec'){
      const balanceCommand=JSON.stringify(params)===JSON.stringify(collectorParams(HELPER,balanceProfile));
      const path=threadCache.get(currentId)?.path;
      const taskCommand=validRollout(path,currentId)&&threadFromPath(currentPath())===currentId&&JSON.stringify(params)===JSON.stringify(taskParams(HELPER,currentId,path));
      if(!balanceCommand&&!taskCommand)return Promise.reject(collectorFailure('installation'));
    }
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
    if (m.type === 'mcp-notification' && m.hostId === 'local' && m.method === 'thread/tokenUsage/updated') {
      const id=m.params?.threadId;
      if(isApiUsage(balance) && validId(id) && m.params?.tokenUsage) {
        const usage=liveUsage(m.params.tokenUsage);if(!usage.available)return;
        liveCache.set(id.toLowerCase(),usage);
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
  const heading=el('header','uc-heading'),headingText=el('div');headingText.append(el('strong',null,'用量详情'));
  const close=el('button',null,'收起 ×');close.type='button';close.setAttribute('aria-label','收起用量详情');heading.append(headingText,close);
  const body=el('div','uc-panel-body');body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-label','用量详情可滚动内容');
  const refresh=el('button','uc-refresh','立即刷新');refresh.type='button';
  listen(refresh,'click',()=>{balanceAt=0;void refreshBalance();void refreshTask();});
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
  const sectionHeading=(title,action)=>{const n=el('div','uc-section-heading');n.append(el('h3',null,title),action);return n;};
  const planBadge=plan=>{const badge=el('span','uc-plan-badge',plan.name);badge.title=plan.name;badge.dataset.state=plan.state||'unknown';return badge;};
  const amount=(value,b)=>typeof value!=='number'||!Number.isFinite(value)?'—':b?.currency?new Intl.NumberFormat('zh-CN',{style:'currency',currency:b.currency,maximumFractionDigits:4}).format(value):number(value)+' '+(b?.unit||'额度单位');
  function balanceTitle(b){
    if(!b)return '余额查询中';
    if(b.state==='not-api')return 'API 工具栏未启用';
    if(b.state!=='ok')return b.code==='changed'?'账户切换中':'余额查询失败';
    if(b.plan?.state==='expired')return b.plan.name+' · 已到期';
    return (b.plan?.name || b.kind || '余额')+' · '+(b.unlimited?'不限额':amount(b.remaining,b));
  }
  function render(){
    if(disposed)return;
    const active=isApiUsage(balance),c=active&&threadFromPath(currentPath())===currentId?conversation:null,title=balanceTitle(balance);
    root.style.display=balance?.state==='not-api'&&!balanceProfile?'none':'';
    summaryNode.replaceChildren();
    if(balance?.state==='ok'&&balance.plan?.name){
      summaryNode.append(planBadge(balance.plan),el('span','uc-summary-value',balance.plan.state==='expired'?'已到期':balance.unlimited?'不限额':amount(balance.remaining,balance)));
    }else summaryNode.append(el('span','uc-summary-value',title));
    summaryNode.title=title;tokenNode.textContent=c?.available?short(c.total)+' Token':'';tokenNode.hidden=!c?.available;
    balanceHint.hidden=true;
    button.setAttribute('aria-label',title+'，展开或收起用量详情');dot.dataset.warning=String(balance?.state==='error');
    const scroll=body.scrollTop;body.replaceChildren();
    refresh.disabled=balanceBusy;refresh.textContent=refresh.disabled?'查询中…':'立即刷新';
    body.append(sectionHeading('API 余额',refresh));
    if(balance?.provider)body.append(row('服务商',balance.provider));
    if(balance?.state==='ok'){
      body.append(row(balance.kind,balance.unlimited?'无限额度':amount(balance.remaining,balance)));
      if(balance.plan){
        const planRow=el('div','uc-row uc-plan-row');planRow.append(el('span',null,'套餐名称'),planBadge(balance.plan));
        body.append(planRow,row('套餐状态',balance.plan.state==='expired'?'已到期':balance.plan.state==='active'?'有效':'详情未返回'));
      }
      if(balance.warning)body.append(el('p','uc-warning',balance.warning));
      if(balance.limit!==null)body.append(row('密钥总额度',amount(balance.limit,balance)));
      if(balance.used!==null)body.append(row('密钥已用额度',amount(balance.used,balance)));
      for(const w of balance.windows||[])body.append(row(w.label+' 剩余',amount(w.remaining,balance),w.resetsAt?new Date(w.resetsAt).toLocaleString('zh-CN')+' 重置':null));
      if(balance.todaySpent!==null)body.append(row('此密钥今日扣费',amount(balance.todaySpent,balance)));
      if(balance.totalSpent!==null)body.append(row('此密钥累计扣费',amount(balance.totalSpent,balance)));
      if(balance.todayRequests!==null)body.append(row('此密钥今日请求',number(balance.todayRequests)));
      if(balance.expiresAt)body.append(row('到期时间',new Date(balance.expiresAt).toLocaleString('zh-CN')));
      if(balance.currency===null)body.append(el('p','uc-note','服务商仅返回内部额度单位，未擅自换算为美元。'));
    }else body.append(el('p',balance?.state==='error'?'uc-warning':'uc-note',balance?.message || (balance?.state==='not-api'?'当前为官方直接登录，API 工具栏已暂停。':'正在读取服务商余额…')));
    if(balance?.updatedAt)body.append(el('p','uc-note uc-balance-updated','余额更新 '+new Date(balance.updatedAt).toLocaleTimeString('zh-CN')));
    const taskRefresh=el('button','uc-refresh',taskBusy?'读取中…':'刷新 Token');taskRefresh.type='button';taskRefresh.disabled=taskBusy||!active;taskRefresh.addEventListener('click',()=>{if(currentId){const cache=threadCache.get(currentId);if(cache)cache.pathAt=0;}void refreshTask();});body.append(sectionHeading('当前任务 Token',taskRefresh));
    if(c?.available){
      const total=el('div','uc-total');total.append(el('small',null,'SESSION TOKENS'),document.createTextNode(number(c.total)),el('span',null,'累计 Token'));body.append(total);
      const metrics=el('div','uc-metrics');metrics.append(row('输入',number(c.input),'包含缓存读取'),row('缓存读取',number(c.cached)),row('非缓存输入',number(c.fresh)),row('输出',number(c.output)),row('其中推理',number(c.reasoning),'已包含在输出内'),row('缓存命中率',c.cachePercent==null?'—':c.cachePercent.toFixed(1)+'%'),row('上下文剩余估计',number(c.contextRemaining),'按最近一次请求；不是账号额度'));body.append(metrics);
      if(c.model)body.append(el('p','uc-note','模型：'+c.model));
      if(c.warning)body.append(el('p','uc-warning',c.warning));
      if(c.updatedAt)body.append(el('p','uc-note','Token 更新 '+new Date(c.updatedAt).toLocaleString('zh-CN')));
    } else body.append(el('p','uc-note',c?.warning || (!active?'切换到 API 供应商后显示当前任务 Token。':currentId?'正在读取当前任务记录…':'打开本机任务后显示 Token；远程任务不会借用本机其他记录。')));
    footer.textContent=VERSION;
    body.scrollTop=scroll;
  }
  async function refreshBalance(){
    if(disposed||document.hidden||balanceBusy||Date.now()-balanceAt<60000)return;
    balanceBusy=true;render();
    try{
      const result=await nativeRequest('rpc','command/exec',collectorParams(HELPER,balanceProfile));
      const value=parseCollectorResult(result);
      if(!disposed){balance=value;if(!isApiUsage(balance)){conversation=null;liveCache.clear();threadCache.clear();}}
    }catch(e){if(!disposed){const failure=e?.code?.startsWith('collector_')?e:collectorFailure('rpc');balance={mode:balance?.mode,activeMode:balance?.activeMode,state:'error',code:failure.code,message:failure.message+'（'+failure.code+'）'};}}
    finally{balanceBusy=false;balanceAt=Date.now();render();if(isApiUsage(balance))void refreshTask();}
  }
  async function readTask(id){
    if(!id)return{available:false,warning:'打开本机任务后显示 Token。'};
    let cached=threadCache.get(id);
    if(!cached || Date.now()-cached.pathAt>60000){
      let response;try{response=await nativeRequest('rpc','thread/read',{threadId:id,includeTurns:false});}catch{throw taskFailure('task_thread');}
      if(response?.thread?.id?.toLowerCase()!==id || !validRollout(response.thread.path,id))throw taskFailure('task_path');
      cached={...cached,path:response.thread.path,pathAt:Date.now()};threadCache.set(id,cached);
      if(threadCache.size>64)threadCache.delete(threadCache.keys().next().value);
    }
    const result=await nativeRequest('rpc','command/exec',taskParams(HELPER,id,cached.path));
    cached.value=parseTaskResult(result,id);
    return newest(cached.value,liveCache.get(id));
  }
  function newest(file,live){return live && (!file.available || Date.parse(live.updatedAt)>Date.parse(file.updatedAt || 0)) ? {...live,model:file.model||null} : file;}
  async function refreshTask(){
    if(disposed||document.hidden||taskBusy||!isApiUsage(balance))return;
    const id=currentId;taskBusy=true;render();
    try{const value=await readTask(id);if(!disposed && id===currentId && threadFromPath(currentPath())===id){conversation=value;render();}}
    catch(e){if(!disposed && id===currentId){const cache=threadCache.get(id);if(cache)cache.pathAt=0;const previous=liveCache.get(id)||cache?.value;const failure=e.code?e:taskFailure('task_read');conversation={...(previous?.available?previous:{available:false}),warning:(previous?.available?'暂时无法刷新，显示上次成功读取的数据。':'')+failure.message+'（'+failure.code+'）'};render();}}
    finally{taskBusy=false;render();if(!disposed && id!==currentId)void refreshTask();}
  }
  function tick(){
    if(disposed||document.hidden)return;checkRoute();const date=new Date();clock.textContent=date.toLocaleTimeString('zh-CN',{hour12:false});clock.dateTime=date.toISOString();
  }
  listen(window,'popstate',checkRoute);listen(window,'hashchange',checkRoute);
  listen(document,'visibilitychange',()=>{if(!document.hidden){place();tick();void refreshBalance();void refreshTask();}});
  rootObserver=new MutationObserver(records=>{if(records.some(r=>!root.contains(r.target) && r.target!==style))schedulePlace();});
  rootObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-app-shell-header-toolbar','aria-hidden']});
  clockTimer=setInterval(tick,1000);refreshTimer=setInterval(()=>{void refreshBalance();void refreshTask();},5000);
  place();render();tick();void refreshBalance();void refreshTask();
})().catch(()=>{
  const state=window.__codexPlusUsageToolbar;
  if(state){state.dispose?.();state.status='failed';state.error='顶部栏初始化失败；请检查当前脚本版本。';}
  queueMicrotask(()=>{const entry=window.__codexPlusUserScripts?.scripts?.['user:codex-usage-toolbar.js'];if(entry){entry.status='failed';entry.error=state?.error || '顶部栏初始化失败';}});
});
