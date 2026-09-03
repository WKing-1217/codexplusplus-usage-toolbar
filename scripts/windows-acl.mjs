import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Never grant access to settings.json, credentials, WindowsApps, or an entire user profile.
// Directory rules are this-folder-only: future files need an explicit installation check.
export function aclTargets(storage,runtime,collector){
 const base=path.resolve(storage),targets=new Set();
 for(const [file,branch] of [[runtime,'runtime'],[collector,'releases']]){
  const resolved=path.resolve(file),relative=path.relative(path.join(base,branch),resolved);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('ACL target is outside managed runtime files');
  for(let cursor=resolved;;cursor=path.dirname(cursor)){
   const stat=fs.lstatSync(cursor);if(stat.isSymbolicLink())throw new Error('ACL target contains a link');
   targets.add(cursor);if(cursor===base)break;
  }
 }
 return [...targets].sort((a,b)=>a.length-b.length);
}
const script=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
try {
 $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
 try { $account=New-Object Security.Principal.NTAccount($env:COMPUTERNAME,'CodexSandboxUsers'); $sid=$account.Translate([Security.Principal.SecurityIdentifier]) }
 catch [Security.Principal.IdentityNotMappedException] { @{state='group-missing';changed=0;missing=0;checked=0} | ConvertTo-Json -Compress; exit 0 }
 $rights=[Security.AccessControl.FileSystemRights]::ReadAndExecute
 $changed=0; $missing=0; $denied=0
 foreach($file in $request.paths){
  $item=Get-Item -LiteralPath $file -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked ACL target'}
  $acl=$item.GetAccessControl()
  $allow=0; $deny=0
  foreach($ace in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
   if($ace.IdentityReference.Value -eq $sid.Value){if($ace.AccessControlType -eq 'Allow'){$allow=$allow -bor [int]$ace.FileSystemRights}else{$deny=$deny -bor [int]$ace.FileSystemRights}}
  }
  if(($deny -band [int]$rights) -ne 0){$denied++;continue}
  if(($allow -band [int]$rights) -ne [int]$rights){
   if($request.repair){
    $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,$rights,[Security.AccessControl.InheritanceFlags]::None,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule);$item.SetAccessControl($acl)
    $verify=$item.GetAccessControl(); $verified=0
    foreach($ace in $verify.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ace.IdentityReference.Value -eq $sid.Value -and $ace.AccessControlType -eq 'Allow'){$verified=$verified -bor [int]$ace.FileSystemRights}}
    if(($verified -band [int]$rights) -ne [int]$rights){throw 'ACL verification failed'}
    $changed++
   }else{$missing++}
  }
 }
 $state=if($denied -gt 0){'explicit-deny'}elseif($missing -gt 0){'missing-read-execute'}else{'ready'}
 @{state=$state;changed=$changed;missing=$missing;denied=$denied;checked=@($request.paths).Count} | ConvertTo-Json -Compress
} catch { @{state='acl-error';changed=0;missing=0;checked=0} | ConvertTo-Json -Compress;exit 1 }
`;
export function sandboxAccess(storage,runtime,collector,{repair=false}={}){
 if(process.platform!=='win32')return{state:'not-windows',changed:0};
 const paths=aclTargets(storage,runtime,collector);
 const result=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{input:JSON.stringify({paths,repair}),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:65536});
 let value;try{value=JSON.parse(result.stdout.trim());}catch{return{state:'acl-error',changed:0};}
 if(result.error||!['ready','group-missing','explicit-deny','missing-read-execute','acl-error'].includes(value.state))return{state:'acl-error',changed:0};
 return value;
}
