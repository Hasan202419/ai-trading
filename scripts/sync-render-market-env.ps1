param(
  [switch]$Redeploy,
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Read-DotEnv($path) {
  if (-not (Test-Path $path)) {
    throw ".env not found. Create .env and add RENDER_API_KEY plus market-data keys."
  }
  $map = @{}
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $index = $line.IndexOf("=")
    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim().Trim('"').Trim("'")
    $map[$key] = $value
  }
  return $map
}

function First-Value($map, [string[]]$keys) {
  foreach ($key in $keys) {
    if ($map.ContainsKey($key) -and $map[$key]) { return $map[$key] }
  }
  return ""
}

function Set-RenderEnv($serviceId, $key, $value, $headers) {
  $body = @{ value = $value } | ConvertTo-Json
  Invoke-RestMethod -Method Put -Headers $headers -Uri "https://api.render.com/v1/services/$serviceId/env-vars/$key" -Body $body | Out-Null
  [pscustomobject]@{ service = $serviceId; key = $key; updated = $true }
}

function Trigger-Deploy($serviceId, $headers) {
  $body = @{ clearCache = "do_not_clear" } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Headers $headers -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Body $body | Out-Null
}

$envMap = Read-DotEnv ".env"
$renderApiKey = First-Value $envMap @("RENDER_API_KEY")
if (-not $renderApiKey) { throw "RENDER_API_KEY is missing in .env." }

$marketKeys = @{
  MASSIVE_API_KEY = First-Value $envMap @("MASSIVE_API_KEY", "Massive_API_KEY", "MASSIVE_API", "Massive_API")
  FINNHUB_API_KEY = First-Value $envMap @("FINNHUB_API_KEY", "Finnhub_API_KEY", "FINNHUB_API", "Finnhub_API")
}

$headers = @{
  Authorization = "Bearer $renderApiKey"
  "Content-Type" = "application/json"
}

$serviceIds = @(
  "srv-d7rmbdhkh4rs73etj7i0",
  "srv-d7rn53n7f7vs73d449r0",
  "srv-d7rn53n7f7vs73d449rg"
)

Write-Host "Market data env check"
foreach ($pair in $marketKeys.GetEnumerator() | Sort-Object Name) {
  Write-Host ("{0,-18} {1}" -f "$($pair.Key):", $(if ($pair.Value) { "set locally" } else { "missing locally" }))
}

if ($CheckOnly) { exit 0 }

foreach ($pair in $marketKeys.GetEnumerator() | Sort-Object Name) {
  if (-not $pair.Value) {
    Write-Host "Skipping $($pair.Key): no local value."
    continue
  }
  foreach ($serviceId in $serviceIds) {
    Set-RenderEnv $serviceId $pair.Key $pair.Value $headers
  }
}

if ($Redeploy) {
  foreach ($serviceId in $serviceIds) {
    Trigger-Deploy $serviceId $headers
  }
  Write-Host "Triggered Render deploys."
}

Write-Host "Done. No secret values were printed."
