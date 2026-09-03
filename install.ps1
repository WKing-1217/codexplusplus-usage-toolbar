param([string]$PreviousReceipt)
$ErrorActionPreference = 'Stop'
$toolbarNode = (Get-Command node -ErrorAction Stop).Source
$toolbarArgs = @((Join-Path $PSScriptRoot 'scripts\manage.mjs'), 'install')
if ($PreviousReceipt) { $toolbarArgs += @('--previous-receipt', $PreviousReceipt) }
& $toolbarNode @toolbarArgs
if ($LASTEXITCODE -ne 0) { throw 'Toolbar installation failed; see the message above.' }
