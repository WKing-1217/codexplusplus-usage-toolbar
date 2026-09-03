import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {collectorParams,parseCollectorResult}=createRequire(import.meta.url)('../src/toolbar.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=data=>createHash('sha256').update(data).digest('hex');
const fileHash=file=>hash(fs.readFileSync(file));
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&(process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b));
function atomic(file,data){
 const temporary=file+'.'+randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,data,{flag:'wx'});fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
function parseArgs(args){
 const options={mode:args.shift()};
 while(args.length){const key=args.shift();if(!['--data-root','--previous-receipt'].includes(key)||!args.length)throw new Error('Unknown or incomplete argument');options[key.slice(2)]=args.shift();}
 if(!['install','rollback','uninstall','status','diagnose'].includes(options.mode))throw new Error('Use install, rollback, uninstall, status or diagnose');
 return options;
}
export function manage(options){
 if(!options['data-root']&&!process.env.APPDATA)throw new Error('Windows APPDATA is unavailable; use an explicit --data-root only for a selected alternate directory.');
 const data=path.resolve(options['data-root']||path.join(process.env.APPDATA,'Codex++'));
 const storage=path.join(data,'usage-toolbar'),statePath=path.join(storage,'installation.json'),target=path.join(data,'user_scripts','codex-usage-toolbar.js'),backupDir=path.join(storage,'backups');
 let state=fs.existsSync(statePath)?json(statePath):null;
 if(state&&!same(state.target,target))throw new Error('Receipt target mismatch');
 const validateCurrent=()=>{
  if(!state||!fs.existsSync(target)||fileHash(target).toLowerCase()!==state.sha256?.toLowerCase())throw new Error('Installed userscript does not match its receipt; no replacement performed.');
 };
 const preserve=()=>{
  fs.mkdirSync(backupDir,{recursive:true});const file=path.join(backupDir,randomUUID()+'.js');fs.copyFileSync(target,file,fs.constants.COPYFILE_EXCL);
  const record={file,sha256:fileHash(file),state};fs.writeFileSync(file+'.json',JSON.stringify(record,null,2),{flag:'wx'});return record;
 };
 if(options.mode==='status')return{installed:fs.existsSync(target),version:state?.version||null,managed:!!state,hashMatches:!!state&&fs.existsSync(target)&&fileHash(target)===state.sha256,target};
 if(options.mode==='diagnose'){
  const checks={version:state?.version||null,script:!!state&&fs.existsSync(target)&&fileHash(target)===state.sha256,runtime:!!state?.runtime&&fs.existsSync(state.runtime)&&fileHash(state.runtime)===state.runtimeSha256,collector:!!state?.collector&&fs.existsSync(state.collector)&&fileHash(state.collector)===state.collectorSha256};
  const report={checks,localProcess:'not-tested',balanceState:'not-tested',code:null,codexBridge:'not-tested'};
  if(checks.script&&checks.runtime&&checks.collector){
   const params=collectorParams(state.helper);const result=spawnSync(params.command[0],params.command.slice(1),{cwd:params.cwd,encoding:'utf8',windowsHide:true,timeout:32000,maxBuffer:1024*1024,env:cleanEnv()});
   report.localProcess=result.error?'failed':result.status===0?'ok':'failed';
   try{const value=parseCollectorResult({exitCode:result.status,stdout:result.stdout,stderr:result.stderr});report.balanceState=value.state;report.code=value.code||null;}catch(e){report.code=result.error?.code==='ETIMEDOUT'?'collector_timeout':e.code||'collector_exit';}
  }else report.code='repair-installation';
  fs.mkdirSync(storage,{recursive:true});const reportPath=path.join(storage,'diagnostics.json');atomic(reportPath,JSON.stringify(report,null,2));
  return{...report,reportPath};
 }
 if(options.mode==='uninstall'){
  if(!fs.existsSync(target))return{state:'already-absent'};
  validateCurrent();const saved=preserve();fs.unlinkSync(target);
  atomic(statePath,JSON.stringify({...state,removed:true,removedBackup:saved.file},null,2));
  return{state:'removed-awaiting-script-reload',backup:saved.file};
 }
 if(options.mode==='rollback'){
  validateCurrent();const previous=state.previous;
  if(!previous?.file||!previous.state)throw new Error('No previous managed version');
  const resolved=path.resolve(previous.file),relative=path.relative(backupDir,resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!same(previous.state.target,target))throw new Error('Unexpected backup path or target');
  if(fileHash(resolved)!==previous.sha256||previous.sha256.toLowerCase()!==previous.state.sha256?.toLowerCase())throw new Error('Backup checksum mismatch');
  preserve();atomic(target,fs.readFileSync(resolved));atomic(statePath,JSON.stringify(previous.state,null,2));
  return{state:'rolled-back-awaiting-script-reload',version:previous.state.version};
 }
 const dist=path.join(root,'dist'),release=json(path.join(dist,'release.json'));
 if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24+ is required. Double-click install.cmd to prepare the runtime.');
 if(!/^\d+\.\d+\.\d+$/.test(release.version))throw new Error('Invalid release version');
 for(const name of ['codex-usage-toolbar.template.js','balance.cjs'])if(!/^[a-f0-9]{64}$/.test(release.files?.[name]||'')||fileHash(path.join(dist,name))!==release.files[name])throw new Error('Release checksum mismatch: '+name);
 const collector=path.join(storage,'releases',release.version+'-'+release.files['balance.cjs'].slice(0,16),'balance.cjs');
 const template=fs.readFileSync(path.join(dist,'codex-usage-toolbar.template.js'),'utf8');
 if(template.split('/*__HELPER__*/null').length!==2)throw new Error('Invalid helper marker');
 const runtimeSha256=fileHash(process.execPath),runtime=path.join(storage,'runtime',process.version+'-'+runtimeSha256.slice(0,16),process.platform==='win32'?'node.exe':'node');
 const helper={node:runtime,script:collector,cwd:path.dirname(collector),settings:path.join(os.homedir(),'.codex-session-delete','settings.json'),allowNet:process.allowedNodeEnvironmentFlags.has('--allow-net'),defaultProfile:''};
 const script=template.replace('/*__HELPER__*/null',JSON.stringify(helper)),sha256=hash(script);
 if(!state&&options['previous-receipt']){
  const previous=json(path.resolve(options['previous-receipt']));
  if(!same(previous.target,target)||!fs.existsSync(target)||fileHash(target).toLowerCase()!==previous.sha256?.toLowerCase())throw new Error('Migration receipt does not match current userscript');
  state={schemaVersion:1,version:previous.version,sha256:previous.sha256.toLowerCase(),target,collector:previous.collector||null,collectorSha256:previous.collectorSha256||null};
 }
 if(fs.existsSync(target))validateCurrent();
 if(fs.existsSync(collector)&&fileHash(collector)!==release.files['balance.cjs'])throw new Error('Versioned collector was modified');
 if(fs.existsSync(runtime)&&fileHash(runtime)!==runtimeSha256)throw new Error('Managed Node runtime was modified; no replacement performed.');
 const unchanged=fs.existsSync(target)&&fileHash(target)===sha256;
 const previous=!unchanged&&fs.existsSync(target)?preserve():state?.previous||null;
 fs.mkdirSync(path.dirname(collector),{recursive:true});
 if(!fs.existsSync(collector))fs.copyFileSync(path.join(dist,'balance.cjs'),collector,fs.constants.COPYFILE_EXCL);
 fs.mkdirSync(path.dirname(runtime),{recursive:true});
 if(!fs.existsSync(runtime))fs.copyFileSync(process.execPath,runtime,fs.constants.COPYFILE_EXCL);
 const preflight=spawnSync(runtime,['--permission','--allow-fs-read='+collector,collector,'--self-test'],{cwd:helper.cwd,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536,env:cleanEnv()});
 if(preflight.status!==0||!preflight.stdout?.includes('"state":"self-test-ok"'))throw new Error('Collector runtime self-test failed. The userscript was not replaced. Check Node/antivirus permissions, then run install.cmd again.');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(!unchanged)atomic(target,script);
 if(fileHash(target)!==sha256)throw new Error('Installed checksum mismatch');
 const next={schemaVersion:1,version:release.version,sha256,target,collector,collectorSha256:release.files['balance.cjs'],runtime,runtimeSha256,helper,previous,installedAt:unchanged?state.installedAt:new Date().toISOString()};
 atomic(statePath,JSON.stringify(next,null,2));
 return{state:unchanged?'already-installed':'installed-awaiting-script-reload',version:release.version,target,selfTest:'passed',backup:previous?.file||null};
}
function cleanEnv(){const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase()==='NODE_OPTIONS')delete env[key];return env;}
if(process.argv[1]&&same(process.argv[1],fileURLToPath(import.meta.url))){try{const options=parseArgs(process.argv.slice(2));const result=manage(options);console.log(JSON.stringify(result,null,2));if(options.mode==='install')console.log('\n安装成功，查询程序启动自检通过。请在 Codex++ 中重新加载脚本；如需重启，请先保存工作。\n仍有问题时双击 diagnose.cmd，报告不会包含密钥或账单。');if(options.mode==='diagnose'){console.log('\n诊断完成。本机查询通过不代表 Codex 命令通道通过；请对照工具栏显示的错误代码。');if(result.code)process.exitCode=1;}}catch(e){console.error(e.message);process.exitCode=1;}}
