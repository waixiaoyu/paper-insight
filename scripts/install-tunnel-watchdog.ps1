[CmdletBinding(DefaultParameterSetName = "Status")]
param(
  [Parameter(ParameterSetName = "Install", Mandatory = $true)]
  [switch]$Install,
  [Parameter(ParameterSetName = "Uninstall", Mandatory = $true)]
  [switch]$Uninstall,
  [Parameter(ParameterSetName = "Status")]
  [switch]$Status,
  [string]$RepositoryPath = (Join-Path $PSScriptRoot ".."),
  [Parameter(ParameterSetName = "Install", Mandatory = $true)]
  [string]$Host,
  [Parameter(ParameterSetName = "Install", Mandatory = $true)]
  [string]$User,
  [Parameter(ParameterSetName = "Install", Mandatory = $true)]
  [string]$IdentityPath,
  [string]$SshPath = "ssh",
  [ValidateRange(1, 65535)]
  [int]$LocalPort = 3001,
  [ValidateRange(1, 65535)]
  [int]$RemotePort = 3000,
  [ValidateRange(1000, 300000)]
  [int]$IntervalMs = 10000
)

$ErrorActionPreference = "Stop"
$taskName = "PaperInsightTunnelWatchdog"
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$watchdogPath = Join-Path $repository "scripts\tunnel-watchdog.mjs"
$stateDirectory = Join-Path $repository ".cache\tunnel-watchdog"
$configPath = Join-Path $stateDirectory "config.json"
$statePath = Join-Path $stateDirectory "state.json"

if (-not (Test-Path -LiteralPath $watchdogPath -PathType Leaf)) {
  throw "Tunnel watchdog script was not found: $watchdogPath"
}

function Get-TaskUserId {
  if ($env:USERDOMAIN -and $env:USERNAME) {
    return "$env:USERDOMAIN\$env:USERNAME"
  }
  return $env:USERNAME
}

function Get-ExistingTask {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

if ($Install) {
  if (-not (Test-Path -LiteralPath $IdentityPath -PathType Leaf)) {
    throw "SSH identity file was not found: $IdentityPath"
  }
  $node = Get-Command node -ErrorAction Stop
  $ssh = Get-Command $SshPath -ErrorAction Stop
  New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  $config = [ordered]@{
    host = $Host
    user = $User
    identity = (Resolve-Path -LiteralPath $IdentityPath).Path
    sshPath = $ssh.Source
    localPort = $LocalPort
    remotePort = $RemotePort
    intervalMs = $IntervalMs
    stateDirectory = $stateDirectory
  }
  $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8

  $arguments = "`"$watchdogPath`" --config `"$configPath`""
  $action = New-ScheduledTaskAction -Execute $node.Source -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId (Get-TaskUserId) -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $existing = Get-ExistingTask
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $taskName
  Write-Output "Installed and started $taskName."
  exit 0
}

if ($Uninstall) {
  $existing = Get-ExistingTask
  if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  Write-Output "Removed $taskName and its state file."
  exit 0
}

$existing = Get-ExistingTask
if ($existing) {
  Write-Output ("Task: {0}" -f $existing.State)
} else {
  Write-Output "Task: not installed"
}
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  Write-Output "State:"
  Get-Content -LiteralPath $statePath -Raw
} else {
  Write-Output "State: unavailable"
}
