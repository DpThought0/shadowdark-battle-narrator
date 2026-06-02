param(
  [string]$FoundryDataPath = "$env:LOCALAPPDATA\FoundryVTT\Data",
  [string]$ModuleId = "shadowdark-battle-narrator"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$modulesPath = Join-Path $FoundryDataPath "modules"
$targetPath = Join-Path $modulesPath $ModuleId

if (-not (Test-Path $modulesPath)) {
  New-Item -ItemType Directory -Path $modulesPath | Out-Null
}

if (Test-Path $targetPath) {
  $resolvedTarget = Resolve-Path $targetPath
  if ($resolvedTarget -eq $repoRoot) {
    Write-Host "Module link already exists: $targetPath"
    exit 0
  }

  throw "A file or folder already exists at $targetPath. Move it before linking this repository."
}

New-Item -ItemType Junction -Path $targetPath -Target $repoRoot | Out-Null
Write-Host "Linked $ModuleId to $targetPath"
