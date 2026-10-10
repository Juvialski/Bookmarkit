param([ValidateSet('pause','resume','stop','remove')][string]$Action,
      [string]$State = "$env:LOCALAPPDATA\Bookmarkit\Goodreads")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $State | Out-Null
switch ($Action) {
 'pause' { New-Item -ItemType File -Force -Path (Join-Path $State 'PAUSE') | Out-Null }
 'resume' { Remove-Item -LiteralPath (Join-Path $State 'PAUSE') -ErrorAction SilentlyContinue }
 'stop' { New-Item -ItemType File -Force -Path (Join-Path $State 'STOP') | Out-Null }
 'remove' {
   New-Item -ItemType File -Force -Path (Join-Path $State 'STOP') | Out-Null
   Unregister-ScheduledTask -TaskName 'Bookmarkit Goodreads Collector' -Confirm:$false -ErrorAction SilentlyContinue
 }
}
# Queue/cache/last-good evidence are deliberately preserved on removal.
