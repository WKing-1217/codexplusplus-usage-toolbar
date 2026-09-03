import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import http from 'node:http';
import {digest,validatePackage,storePackage} from './package.mjs';
const repository='WKing-1217/codexplusplus-usage-toolbar';
export function proxyEnvironment(env,windows={}){
 if(env.https_proxy||env.HTTPS_PROXY||env.http_proxy||env.HTTP_PROXY)return env;
 if(Number(windows.ProxyEnable)!==1||!windows.ProxyServer)return null;
 const server=String(windows.ProxyServer).trim();
 let selected=server;
 if(server.includes('='))selected=server.split(';').map(v=>v.trim()).find(v=>/^https=/i.test(v))?.slice(6);
 if(!selected)throw new Error('系统未配置 HTTPS 下载代理。请在代理软件中启用系统 HTTP/HTTPS 代理后重试。');
 const url=new URL(selected.includes('://')?selected:'http://'+selected);
 if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.search||url.hash)throw new Error('Unsupported system proxy');
 const bypass=String(windows.ProxyOverride||'').split(';').map(v=>v.trim()).filter(v=>v&&v!=='<local>').join(',');
 return {HTTPS_PROXY:url.href,NO_PROXY:env.no_proxy||env.NO_PROXY||bypass};
}
export function configureUpdateProxy(){
 try{
  let windows={};
  if(process.platform==='win32'&&!process.env.https_proxy&&!process.env.HTTPS_PROXY&&!process.env.http_proxy&&!process.env.HTTP_PROXY){
   const script=String.raw`[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$p=Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue;@{ProxyEnable=$p.ProxyEnable;ProxyServer=$p.ProxyServer;ProxyOverride=$p.ProxyOverride}|ConvertTo-Json -Compress`;
   const r=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:16384});
   if(r.status===0)windows=JSON.parse(r.stdout.trim());
  }
  const proxy=proxyEnvironment(process.env,windows);
  if(!proxy)return()=>{};
  if(typeof http.setGlobalProxyFromEnv!=='function')throw new Error('Incompatible runtime');
  return http.setGlobalProxyFromEnv(proxy);
 }catch{throw new Error('无法使用当前下载代理。请检查系统 HTTP/HTTPS 代理，或重新运行新版 install.cmd 准备兼容运行时。');}
}
export function newer(a,b){const parts=v=>/^\d+\.\d+\.\d+$/.test(v)?v.split('.').map(Number):null;const x=parts(a),y=parts(b);if(!x||!y)throw new Error('Invalid release version');for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;}
export function releaseAsset(release){
 const version=releaseVersion(release);
 const name='codexplusplus-usage-toolbar-v'+version+'.update.json',asset=release.assets?.find(v=>v.name===name);
 if(!asset||asset.state!=='uploaded'||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||!(asset.size>0&&asset.size<=4*1024*1024))throw new Error('Verified update asset is unavailable; use the GitHub release page.');
 if(asset.browser_download_url!=='https://github.com/'+repository+'/releases/download/v'+version+'/'+name)throw new Error('Unexpected update source');
 return {version,asset};
}
function releaseVersion(release){
 const version=release?.tag_name?.replace(/^v/,'');
 if(!version||release.tag_name!=='v'+version||!/^\d+\.\d+\.\d+$/.test(version)||release.draft||release.prerelease)throw new Error('Latest release is not a stable version');
 return version;
}
async function download(url,maxBytes,fetchImpl){
 // Public requests only: never send GitHub tokens or provider credentials.
 let current=new URL(url);
 for(let redirects=0;redirects<4;redirects++){
  if(current.protocol!=='https:'||current.username||current.password||!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(current.hostname))throw new Error('Unexpected download redirect');
  const response=await fetchImpl(current,{headers:{accept:'application/vnd.github+json','user-agent':'codexplusplus-usage-toolbar-updater'},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(!location)throw new Error('Invalid download redirect');current=new URL(location,current);continue;}
  if(!response.ok)throw new Error('Update download failed: HTTP '+response.status);
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>maxBytes){await reader.cancel();throw new Error('Update download is too large');}chunks.push(Buffer.from(chunk.value));}
  return Buffer.concat(chunks);
 }
 throw new Error('Too many update redirects');
}
export async function update({dataRoot,fetchImpl=fetch,run=spawnSync,log=console.log}={}){
 if(!dataRoot&&!process.env.APPDATA)throw new Error('Windows APPDATA is unavailable');
 const data=path.resolve(dataRoot||path.join(process.env.APPDATA,'Codex++')),storage=path.join(data,'usage-toolbar');
 const state=JSON.parse(fs.readFileSync(path.join(storage,'installation.json'),'utf8'));
 const target=path.join(data,'user_scripts','codex-usage-toolbar.js');
 const sameTarget=process.platform==='win32'?path.resolve(state.target).toLowerCase()===target.toLowerCase():path.resolve(state.target)===target;
 if(!sameTarget||state.removed||digest(fs.readFileSync(target))!==state.sha256)throw new Error('Installed script does not match its receipt; repair the installation before updating.');
 const restoreProxy=fetchImpl===fetch?configureUpdateProxy():()=>{};
 try{
 log('正在检查 GitHub 最新正式版…');
 const latest=JSON.parse((await download('https://api.github.com/repos/'+repository+'/releases/latest',1024*1024,fetchImpl)).toString('utf8'));
 const version=releaseVersion(latest);
 if(!newer(version,state.version))return{state:'up-to-date',version:state.version};
 const {asset}=releaseAsset(latest);
 log('正在下载并校验 '+version+'…');
 const bytes=await download(asset.browser_download_url,asset.size,fetchImpl);
 if(bytes.length!==asset.size||'sha256:'+digest(bytes)!==asset.digest)throw new Error('Update package checksum mismatch; installed version was not changed.');
 const value=validatePackage(JSON.parse(bytes.toString('utf8')),version),stage=storePackage(storage,value);
 const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase()==='NODE_OPTIONS')delete env[key];
 const result=run(process.execPath,[path.join(stage,'scripts','manage.mjs'),'install','--data-root',data],{cwd:stage,env,encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:1024*1024});
 if(result.status!==0)throw new Error('新版安装失败，未自动重启 Codex。请运行“修复”或“诊断”入口。');
 const installed=JSON.parse(fs.readFileSync(path.join(storage,'installation.json'),'utf8'));
 if(installed.version!==version||digest(fs.readFileSync(target))!==installed.sha256)throw new Error('Installed update verification failed');
 return{state:'updated-awaiting-script-reload',version,previousVersion:state.version};
 }finally{restoreProxy();}
}
