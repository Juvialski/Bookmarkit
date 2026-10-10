param([Parameter(Mandatory)][string]$Python, [Parameter(Mandatory)][string]$Cli,
      [string]$State = "$env:LOCALAPPDATA\Bookmarkit\Goodreads")
$ErrorActionPreference = 'Stop'
$worker = Join-Path $PSScriptRoot '..\goodreads_worker.py'
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'Idle'
if ((Test-Path -LiteralPath (Join-Path $State 'STOP')) -or (Test-Path -LiteralPath (Join-Path $State 'PAUSE'))) { exit 0 }
$arguments = @($worker, '--state', $State, '--cli', $Cli, '--limit', '5')
$credential = Join-Path $State 'collector-token.dpapi'
if (Test-Path -LiteralPath $credential) { $arguments += @('--sync-credential', $credential) }
& $Python @arguments
exit $LASTEXITCODE
