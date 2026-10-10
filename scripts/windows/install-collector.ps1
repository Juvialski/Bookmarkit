param([Parameter(Mandatory)][string]$Python, [Parameter(Mandatory)][string]$Cli,
      [Parameter(Mandatory)][string]$PilotReport, [string]$State = "$env:LOCALAPPDATA\Bookmarkit\Goodreads")
$ErrorActionPreference = 'Stop'
$report = Get-Content -LiteralPath $PilotReport -Raw | ConvertFrom-Json
if ($report.attempted -lt 100 -or $report.verified_rate -lt 0.8 -or $report.circuit_open -or $report.precision -ne 'independently adjudicated') {
    throw 'Pilot gate failed: require 100 attempts, >=80% verified coverage, adjudicated precision, and no open blocking circuit. No task installed.'
}
$Python = (Resolve-Path -LiteralPath $Python).Path
$Cli = (Resolve-Path -LiteralPath $Cli).Path
$runner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'collector.ps1')).Path
New-Item -ItemType Directory -Force -Path $State | Out-Null
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Python `"$Python`" -Cli `"$Cli`" -State `"$State`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RunOnlyIfIdle -IdleDuration (New-TimeSpan -Minutes 2) -IdleWaitTimeout (New-TimeSpan -Minutes 5) -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
# Default scheduler settings disallow battery starts and stop on battery changes.
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Bookmarkit Goodreads Collector' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'Bookmarkit Goodreads Collector'
