import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
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
 if(!['install','rollback','uninstall','status'].includes(options.mode))throw new Error('Use install, rollback, uninstall or status');
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
 if(!/^\d+\.\d+\.\d+$/.test(release.version))throw new Error('Invalid release version');
 for(const name of ['codex-usage-toolbar.template.js','balance.cjs'])if(!/^[a-f0-9]{64}$/.test(release.files?.[name]||'')||fileHash(path.join(dist,name))!==release.files[name])throw new Error('Release checksum mismatch: '+name);
 const collector=path.join(storage,'releases',release.version+'-'+release.files['balance.cjs'].slice(0,16),'balance.cjs');
 const template=fs.readFileSync(path.join(dist,'codex-usage-toolbar.template.js'),'utf8');
 if(template.split('/*__HELPER__*/null').length!==2)throw new Error('Invalid helper marker');
 const script=template.replace('/*__HELPER__*/null',JSON.stringify({node:process.execPath,script:collector,defaultProfile:''})),sha256=hash(script);
 if(!state&&options['previous-receipt']){
  const previous=json(path.resolve(options['previous-receipt']));
  if(!same(previous.target,target)||!fs.existsSync(target)||fileHash(target).toLowerCase()!==previous.sha256?.toLowerCase())throw new Error('Migration receipt does not match current userscript');
  state={schemaVersion:1,version:previous.version,sha256:previous.sha256.toLowerCase(),target,collector:previous.collector||null,collectorSha256:previous.collectorSha256||null};
 }
 if(fs.existsSync(target))validateCurrent();
 if(fs.existsSync(collector)&&fileHash(collector)!==release.files['balance.cjs'])throw new Error('Versioned collector was modified');
 const unchanged=fs.existsSync(target)&&fileHash(target)===sha256;
 const previous=!unchanged&&fs.existsSync(target)?preserve():state?.previous||null;
 fs.mkdirSync(path.dirname(collector),{recursive:true});
 if(!fs.existsSync(collector))fs.copyFileSync(path.join(dist,'balance.cjs'),collector,fs.constants.COPYFILE_EXCL);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 if(!unchanged)atomic(target,script);
 if(fileHash(target)!==sha256)throw new Error('Installed checksum mismatch');
 const next={schemaVersion:1,version:release.version,sha256,target,collector,collectorSha256:release.files['balance.cjs'],previous,installedAt:unchanged?state.installedAt:new Date().toISOString()};
 atomic(statePath,JSON.stringify(next,null,2));
 return{state:unchanged?'already-installed':'installed-awaiting-script-reload',version:release.version,target,backup:previous?.file||null};
}
if(process.argv[1]&&same(process.argv[1],fileURLToPath(import.meta.url))){try{console.log(JSON.stringify(manage(parseArgs(process.argv.slice(2))),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
