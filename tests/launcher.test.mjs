import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('double-click CMD works under Restricted PowerShell policy with spaces, Chinese and ampersands; no policy change', {skip:process.platform!=='win32'},()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toolbar-cmd-')),source=path.join(dir,'中文 & package with spaces'),data=path.join(dir,'roaming');
 fs.mkdirSync(source);for(const name of ['package.json','install.cmd','diagnose.cmd','uninstall.cmd','rollback.cmd','update.cmd','repair.cmd','scripts','src','dist'])fs.cpSync(path.join(root,name),(path.isAbsolute(name)?name:path.join(source,name)),{recursive:true});
 const env={...process.env,APPDATA:data,LOCALAPPDATA:path.join(dir,'local'),USERPROFILE:path.join(dir,'user'),TOOLBAR_NO_PAUSE:'1',PSExecutionPolicyPreference:'Restricted'};
 const run=name=>spawnSync('cmd.exe',['/d','/s','/c','""'+(path.isAbsolute(name)?name:path.join(source,name))+'""'],{env,encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true,timeout:30000});
 const installed=run('install.cmd');assert.equal(installed.status,0,installed.stdout+'\n'+installed.stderr);
 const receipt=JSON.parse(fs.readFileSync(path.join(data,'Codex++','usage-toolbar','installation.json')));
 assert(fs.existsSync(receipt.runtime));assert.notEqual(receipt.runtime,process.execPath);assert.equal(receipt.helper.settings,path.join(env.USERPROFILE,'.codex-session-delete','settings.json'));
 assert.equal(run('install.cmd').status,0);
 const diagnosed=run('diagnose.cmd');assert.equal(diagnosed.status,1,'Missing fixture settings should fail diagnosis, not installation');
 const report=JSON.parse(fs.readFileSync(path.join(data,'Codex++','usage-toolbar','diagnostics.json')));
 assert.equal(report.localProcess,'ok');assert.equal(report.code,'configuration');assert.equal(report.codexBridge,'not-tested');
 assert(!JSON.stringify(report).includes(env.USERPROFILE));
 // Renaming the extracted source proves installed maintenance is self-contained.
 const moved=path.join(dir,'old-download-renamed');assert(path.resolve(moved).startsWith(path.resolve(dir)+path.sep));assert(path.resolve(source).startsWith(path.resolve(dir)+path.sep));fs.renameSync(source,moved);
 const menu=path.join(data,'Microsoft','Windows','Start Menu','Programs','Codex++ Usage Toolbar','Codex++ 用量栏修复.lnk');
 const shortcut=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::InputEncoding=New-Object Text.UTF8Encoding($false);[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);$s=New-Object -ComObject WScript.Shell;$s.CreateShortcut([Console]::In.ReadToEnd()).TargetPath"],{input:menu,env,encoding:'utf8',windowsHide:true});
 assert.equal(shortcut.status,0);assert.equal(shortcut.stdout.trim(),path.join(data,'Codex++','usage-toolbar','repair.cmd'));
 const repaired=run(shortcut.stdout.trim());assert.equal(repaired.status,0,repaired.stdout+'\n'+repaired.stderr);
 const removed=run(path.join(data,'Codex++','usage-toolbar','uninstall.cmd'));assert.equal(removed.status,0,removed.stdout+'\n'+removed.stderr);assert(!fs.existsSync(receipt.target));
});
