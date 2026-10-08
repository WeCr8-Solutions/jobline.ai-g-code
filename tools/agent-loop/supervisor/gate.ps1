# Supervised CI gate for Windows (started by start.ps1 when JOBLINE_AGENT_GATE=1).
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $Root
$State = Join-Path $Root '.agent-loop'
$envFile = Join-Path $State 'host.env'
if (Test-Path $envFile) { foreach ($line in Get-Content $envFile) { if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process') } } }
$wait = 30
while (-not (Test-Path (Join-Path $State 'STOP'))) {
  & node tools/agent-loop/cli.mjs gate --watch --file-tasks *>> (Join-Path $State "logs\gate-$(Get-Date -Format yyyyMMdd).log")
  if (Test-Path (Join-Path $State 'STOP')) { break }
  Start-Sleep -Seconds $wait
  $wait = [Math]::Min($wait * 2, 900)
}
