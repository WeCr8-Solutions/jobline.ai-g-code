# Supervised agent loop for Windows. From the repo root:
#   powershell -ExecutionPolicy Bypass -File tools\agent-loop\supervisor\start.ps1
# Stop it: New-Item .agent-loop\STOP   (or tools\agent-loop\supervisor\stop.ps1)
#
# Restarts the loop after a crash (backing off), updates with git pull --ff-only
# on each restart, keeps the PC awake while running, and also supervises the CI
# gate on the one computer with JOBLINE_AGENT_GATE=1.
$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location $Root
$State = Join-Path $Root '.agent-loop'
New-Item -ItemType Directory -Force -Path (Join-Path $State 'logs') | Out-Null
Remove-Item (Join-Path $State 'STOP') -ErrorAction SilentlyContinue

$envFile = Join-Path $State 'host.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process') }
  }
}

# Keep the PC awake (system, not display) while this script runs.
Add-Type -Namespace Jobline -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[Jobline.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

function Log($msg) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [supervisor] $msg"; Write-Host $line; Add-Content (Join-Path $State 'logs\supervisor.log') $line }

function Update-Code {
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Log 'no upstream branch; not pulling'; return }
  git diff --quiet; $clean = ($LASTEXITCODE -eq 0); git diff --cached --quiet; $clean = $clean -and ($LASTEXITCODE -eq 0)
  if (-not $clean) { Log 'local changes present; not pulling'; return }
  $before = git rev-parse HEAD
  git pull --ff-only -q 2>> (Join-Path $State 'logs\supervisor.log')
  if ($LASTEXITCODE -ne 0) { Log 'git pull failed; running the current code'; return }
  $after = git rev-parse HEAD
  if ($before -ne $after) {
    Log "updated to $($after.Substring(0,7))"
    git diff --quiet $before HEAD -- package-lock.json
    if ($LASTEXITCODE -ne 0) { Log 'dependencies changed; npm ci'; npm ci --no-audit --no-fund *>> (Join-Path $State 'logs\supervisor.log') }
  }
}

$runArgs = @('tools/agent-loop/cli.mjs', 'run', '--watch', '--restart-every', $(if ($env:JOBLINE_AGENT_RESTART_EVERY) { $env:JOBLINE_AGENT_RESTART_EVERY } else { '3h' }))
if ($env:JOBLINE_AGENT_UNTIL) { $runArgs += @('--until', $env:JOBLINE_AGENT_UNTIL) }

node tools/agent-loop/cli.mjs doctor | Tee-Object -Append -FilePath (Join-Path $State 'logs\supervisor.log')

if ($env:JOBLINE_AGENT_GATE -eq '1') {
  # The gate runs as a separate supervised process; it exits on its own when STOP appears.
  Start-Process -WindowStyle Minimized powershell -ArgumentList @('-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'gate.ps1'))
}

$wait = 30
while (-not (Test-Path (Join-Path $State 'STOP'))) {
  Update-Code
  Log 'run starting'
  $logFile = Join-Path $State "logs\run-$(Get-Date -Format yyyyMMdd).log"
  & node @runArgs *>> $logFile
  $code = $LASTEXITCODE
  if (Test-Path (Join-Path $State 'STOP')) { break }
  if ($code -eq 75) { Log 'scheduled restart'; $wait = 30; continue }
  if ($code -eq 0 -and $env:JOBLINE_AGENT_UNTIL) { Log 'reached its stop time'; break }
  Log "run exited with $code; restarting in ${wait}s"
  Start-Sleep -Seconds $wait
  $wait = [Math]::Min($wait * 2, 900)
}
Log 'run stopped'
[Jobline.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
