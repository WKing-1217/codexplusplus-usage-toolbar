$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'scripts\manage.mjs') uninstall
if ($LASTEXITCODE -ne 0) { throw 'Toolbar uninstall failed.' }
