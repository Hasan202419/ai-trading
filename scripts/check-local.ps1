param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Find-CommandPath($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Find-CodexNode {
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

function Find-Npm {
  $cmd = Find-CommandPath "npm"
  if ($cmd) { return $cmd }
  $candidate = "C:\Program Files\nodejs\npm.cmd"
  if (Test-Path $candidate) { return $candidate }
  return $null
}

$nodePath = Find-CodexNode
if (-not $nodePath) {
  $nodePath = Find-CommandPath "node"
}

$npmPath = Find-Npm

Write-Host "JARVIS local readiness"
Write-Host "Workspace: $root"
Write-Host "Node:      $(if ($nodePath) { $nodePath } else { 'MISSING' })"
Write-Host "npm:       $(if ($npmPath) { $npmPath } else { 'MISSING - install Node.js LTS from nodejs.org' })"

if (-not (Test-Path ".env")) {
  Write-Host ".env:      MISSING - copy .env.example to .env and fill Supabase/Alpaca keys"
} else {
  Write-Host ".env:      present"
  $envText = Get-Content ".env" -Raw
  $requiredKeys = @(
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ALPACA_API_KEY_ID",
    "ALPACA_API_SECRET_KEY"
  )
  foreach ($key in $requiredKeys) {
    $match = [regex]::Match($envText, "(?m)^$key=(.+)$")
    $status = if ($match.Success -and $match.Groups[1].Value.Trim().Length -gt 0) { "set" } else { "missing" }
    Write-Host ("{0,-26} {1}" -f "${key}:", $status)
  }
  $alpacaKeyId = [regex]::Match($envText, "(?m)^ALPACA_API_KEY_ID=(.+)$")
  if ($alpacaKeyId.Success) {
    $value = $alpacaKeyId.Groups[1].Value.Trim()
    if ($value.Length -gt 80) {
      Write-Host "WARNING: ALPACA_API_KEY_ID looks too long. Use the Alpaca paper Key ID, not a Supabase/JWT token."
    }
  }
}

if (-not $nodePath) {
  throw "Node.js is required. Install Node.js LTS, then rerun this script."
}

if (-not $SkipTests) {
  Write-Host ""
  Write-Host "Running core tests..."
  & $nodePath "test\core.test.js"
}

Write-Host ""
Write-Host "Next commands after npm is installed:"
Write-Host "  npm install"
Write-Host "  npm test"
Write-Host "  npm start"
Write-Host "  npm run worker"
Write-Host "  npm run mcp"
