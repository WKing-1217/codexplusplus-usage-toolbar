$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'scripts\manage.mjs') rollback
if ($LASTEXITCODE -ne 0) { throw 'Toolbar rollback failed.' }
