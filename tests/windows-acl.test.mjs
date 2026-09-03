import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {aclTargets,sandboxAccess} from '../scripts/windows-acl.mjs';
test('runtime ACL repair adds only sandbox read/execute, leaves credentials and deny rules untouched',{skip:process.platform!=='win32'},t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'toolbar-acl-')),storage=path.join(base,'usage-toolbar');
 const runtime=path.join(storage,'runtime','fixture','node.exe'),collector=path.join(storage,'releases','fixture','balance.cjs'),settings=path.join(base,'settings.json');
 for(const file of [runtime,collector,settings]){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'fixture');}
 const ps=(script,input)=>{const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{input,encoding:'utf8',windowsHide:true,env:{...process.env,PSExecutionPolicyPreference:'Restricted'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 if(sandboxAccess(storage,runtime,collector).state==='group-missing'){t.skip('Codex sandbox group not initialized');return;}
 const settingsAcl=ps('$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$i.GetAccessControl().Sddl',settings);
 ps("$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$acl=New-Object Security.AccessControl.FileSecurity;$acl.SetAccessRuleProtection($true,$false);$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')));$i.SetAccessControl($acl)",runtime);
 assert.equal(sandboxAccess(storage,runtime,collector).state,'missing-read-execute');
 const fixed=sandboxAccess(storage,runtime,collector,{repair:true});assert.equal(fixed.state,'ready');assert(fixed.changed>=1);
 const inspect=String.raw`$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$sid=(New-Object Security.Principal.NTAccount($env:COMPUTERNAME,'CodexSandboxUsers')).Translate([Security.Principal.SecurityIdentifier]);$acl=$i.GetAccessControl();$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|Where-Object {$_.IdentityReference.Value -eq $sid.Value});@($rules|ForEach-Object {@{rights=[int]$_.FileSystemRights;inheritance=[int]$_.InheritanceFlags;type=[int]$_.AccessControlType}})|ConvertTo-Json -Compress`;
 const rules=JSON.parse(ps(inspect,runtime));const rows=Array.isArray(rules)?rules:[rules];assert(rows.length);for(const r of rows){assert.equal(r.rights&278,0);assert.equal(r.inheritance,0);assert.equal(r.type,0);}
 assert.equal(sandboxAccess(storage,runtime,collector,{repair:true}).changed,0);
 assert.equal(ps('$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$i.GetAccessControl().Sddl',settings),settingsAcl);
 assert(!aclTargets(storage,runtime,collector).includes(settings));assert.throws(()=>aclTargets(storage,settings,collector),/outside/);
 ps("$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$sid=(New-Object Security.Principal.NTAccount($env:COMPUTERNAME,'CodexSandboxUsers')).Translate([Security.Principal.SecurityIdentifier]);$acl=$i.GetAccessControl();$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'ExecuteFile','Deny')));$i.SetAccessControl($acl)",runtime);
 const deniedAcl=ps('$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$i.GetAccessControl().Sddl',runtime);
 assert.equal(sandboxAccess(storage,runtime,collector,{repair:true}).state,'explicit-deny');assert.equal(ps('$i=Get-Item -LiteralPath ([Console]::In.ReadToEnd());$i.GetAccessControl().Sddl',runtime),deniedAcl);
});
