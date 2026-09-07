[CmdletBinding(DefaultParameterSetName = "Status")]
param(
  [Parameter(ParameterSetName = "Install", Mandatory = $true)][switch]$Install,
  [Parameter(ParameterSetName = "Uninstall", Mandatory = $true)][switch]$Uninstall,
  [Parameter(ParameterSetName = "Status")][switch]$Status,
  [string]$RepositoryPath = "",
  [ValidateRange(1, 65535)][int]$Port = 3100,
  [ValidateRange(1000, 300000)][int]$IntervalMs = 10000,
  [ValidateRange(0, 300000)][int]$StartupGraceMs = 5000
)
$ErrorActionPreference = "Stop"
if (-not $RepositoryPath) { $RepositoryPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) ".." }
$taskName = "PaperInsightLocalServerWatchdog"
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$watchdogPath = Join-Path $repository "scripts\local-server-watchdog.mjs"
$stateDirectory = Join-Path $repository ".cache\local-server-watchdog"
$statePath = Join-Path $stateDirectory "state.json"
$configPath = Join-Path $stateDirectory "config.json"
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

function Stop-ExistingWatchdog {
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node $watchdogPath --config $configPath --stop
    if ($LASTEXITCODE -ne 0) { throw "Existing watchdog did not stop cleanly." }
  }
}

if ($Uninstall) {
  if ($existing) {
    Stop-ExistingWatchdog
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  Write-Output "Removed $taskName. Configuration, logs and application data are preserved."
  exit 0
}

if ($Install) {
  foreach ($file in @($watchdogPath, (Join-Path $repository 'server.js'), (Join-Path $repository 'scripts\local-server-child.mjs'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file is missing: $file" }
  }
  $node = (Get-Command node -ErrorAction Stop).Source
  $taskShell = (Get-Command powershell.exe -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  if ($existing) {
    Stop-ExistingWatchdog
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  }
  [ordered]@{ repositoryPath = $repository; nodePath = $node; port = $Port;
    intervalMs = $IntervalMs; startupGraceMs = $StartupGraceMs; stateDirectory = $stateDirectory
  } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
  # Escape literal PowerShell path arguments, including apostrophes in the repository path.
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "& ''{0}'' ''{1}'' --config ''{2}''; exit $LASTEXITCODE"' -f $node.Replace("'", "''"), $watchdogPath.Replace("'", "''"), $configPath.Replace("'", "''")
  $action = New-ScheduledTaskAction -Execute $taskShell -Argument $arguments -WorkingDirectory $repository
  $taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
  $principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Installed and started $taskName. URL: http://127.0.0.1:$Port"
  exit 0
}

if (-not $existing) { Write-Output "Task: not installed"; exit 0 }
Write-Output ("Task: {0}" -f $existing.State)
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $watchdogProcess = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
  $childProcess = if ($state.childPid) { Get-Process -Id $state.childPid -ErrorAction SilentlyContinue } else { $null }
  $recent = $false
  if ($state.lastHealthyAt) { $recent = ((Get-Date).ToUniversalTime() - [DateTime]::Parse($state.lastHealthyAt).ToUniversalTime()).TotalSeconds -lt 60 }
  if (-not $watchdogProcess) { Write-Output "Health: watchdog is not running (stored state is stale)" }
  elseif ($childProcess -and $recent -and $state.status -eq 'healthy') { Write-Output "Health: healthy" }
  else { Write-Output "Health: starting or recovering; see lastError below" }
  $state | ConvertTo-Json
} else { Write-Output "Health: no runtime state; check scheduled-task history" }
