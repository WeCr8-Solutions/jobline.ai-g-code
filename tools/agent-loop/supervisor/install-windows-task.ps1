# Start the supervised loop at logon, every day, on this Windows PC.
#   powershell -ExecutionPolicy Bypass -File tools\agent-loop\supervisor\install-windows-task.ps1
# Remove with: Unregister-ScheduledTask -TaskName "JobLine Agent Loop ($repo)" -Confirm:$false
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$repo = Split-Path $Root -Leaf
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -WindowStyle Minimized -File `"$PSScriptRoot\start.ps1`"" -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Days 30)
Register-ScheduledTask -TaskName "JobLine Agent Loop ($repo)" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Installed: the loop for $repo starts at logon. Start it now with: Start-ScheduledTask -TaskName 'JobLine Agent Loop ($repo)'"
