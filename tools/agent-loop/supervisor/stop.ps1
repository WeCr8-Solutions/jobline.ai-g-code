# Ask the supervised loop to stop after its current steps.
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
New-Item -ItemType Directory -Force -Path (Join-Path $Root '.agent-loop') | Out-Null
New-Item -ItemType File -Force -Path (Join-Path $Root '.agent-loop\STOP') | Out-Null
Write-Host 'Stop requested; running tasks finish and pause.'
