param(
  [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$envPath = Join-Path $root ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
  throw ".env not found."
}

function Read-DotEnv($path) {
  $map = [ordered]@{}
  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith("#") -or -not $line.Contains("=")) { return }
    $index = $line.IndexOf("=")
    $key = $line.Substring(0, $index).Trim()
    $value = $line.Substring($index + 1).Trim()
    if ($key) { $map[$key] = $value }
  }
  return $map
}

function Add-Section($out, $known, $map, $title, [string[]]$keys, $defaults) {
  $out.Add("") | Out-Null
  $out.Add("# $title") | Out-Null
  foreach ($key in $keys) {
    $known[$key] = $true
    $value = ""
    if ($map.Contains($key)) {
      $value = [string]$map[$key]
    } elseif ($defaults.ContainsKey($key)) {
      $value = [string]$defaults[$key]
    }
    $out.Add("$key=$value") | Out-Null
  }
}

function Write-Status($map) {
  $keys = @(
    "RENDER_API_KEY",
    "ALPACA_API_KEY_ID",
    "ALPACA_API_SECRET_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "MASSIVE_API_KEY",
    "FINNHUB_API_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "OPENAI_APPS_CHALLENGE_TOKEN"
  )
  foreach ($key in $keys) {
    $hasValue = $map.Contains($key) -and ([string]$map[$key]).Trim().Length -gt 0
    Write-Host ("{0,-30} {1}" -f "${key}:", $(if ($hasValue) { "set" } else { "missing" }))
  }
}

$map = Read-DotEnv $envPath
if ($StatusOnly) {
  Write-Status $map
  exit 0
}

$backupDir = Join-Path $env:TEMP "jarvis-env-backups"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backupPath = Join-Path $backupDir (".env.{0}.bak" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Copy-Item -LiteralPath $envPath -Destination $backupPath -Force

$defaults = @{
  NODE_ENV = "development"
  PORT = "3000"
  MCP_PORT = "3333"
  WORKER_INTERVAL_MS = "60000"
  TRADING_MODE = "paper"
  REQUIRE_MANUAL_APPROVAL = "true"
  ALPACA_BASE_URL = "https://paper-api.alpaca.markets"
  ALPACA_DATA_BASE_URL = "https://data.alpaca.markets"
  ALPACA_DATA_FEED = "iex"
  ALPACA_DATA_DELAY_MINUTES = "15"
  OPENAI_MODEL = "gpt-5.4-mini"
  OPENAI_BASE_URL = "https://api.openai.com/v1"
  MARKET_DATA_PROVIDER = "auto"
  MARKET_DATA_PROVIDER_PRIORITY = "alpaca,massive,finnhub,yahoo"
  MARKET_DATA_DEFAULT_SYMBOL = "SPY"
  MARKET_DATA_DEFAULT_TIMEFRAME = "1"
  YAHOO_FINANCE_ENABLED = "true"
  YAHOO_FINANCE_BASE_URL = "https://query1.finance.yahoo.com"
  YAHOO_FINANCE_DATA_DELAY_MINUTES = "15"
  MASSIVE_BASE_URL = "https://api.massive.com"
  MASSIVE_DATA_DELAY_MINUTES = "15"
  FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
  FINNHUB_DATA_DELAY_MINUTES = "0"
  FINVIZ_DATA_DELAY_MINUTES = "15"
  APP_PUBLIC_URL = "https://jarvis-api-5roc.onrender.com"
  MCP_PUBLIC_URL = "https://jarvis-mcp-pwxy.onrender.com"
}

$out = New-Object System.Collections.Generic.List[string]
$known = @{}
$out.Add("# JARVIS Algo Trader local environment") | Out-Null
$out.Add("# Keep this file private. Do not commit it to GitHub.") | Out-Null

Add-Section $out $known $map "Local services" @("NODE_ENV", "PORT", "MCP_PORT", "WORKER_INTERVAL_MS") $defaults
Add-Section $out $known $map "Safety: paper trading only" @("TRADING_MODE", "REQUIRE_MANUAL_APPROVAL") $defaults
Add-Section $out $known $map "Public URLs after Render deploy" @("APP_PUBLIC_URL", "MCP_PUBLIC_URL") $defaults
Add-Section $out $known $map "Alpaca paper trading" @("ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "ALPACA_BASE_URL", "ALPACA_DATA_BASE_URL", "ALPACA_DATA_FEED", "ALPACA_DATA_DELAY_MINUTES") $defaults
Add-Section $out $known $map "Supabase" @("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN") $defaults
Add-Section $out $known $map "OpenAI advisory analysis" @("OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL") $defaults
Add-Section $out $known $map "Render deploy automation" @("RENDER_API_KEY") $defaults
Add-Section $out $known $map "Market data providers" @("MARKET_DATA_PROVIDER", "MARKET_DATA_PROVIDER_PRIORITY", "MARKET_DATA_DEFAULT_SYMBOL", "MARKET_DATA_DEFAULT_TIMEFRAME", "YAHOO_FINANCE_ENABLED", "YAHOO_FINANCE_BASE_URL", "YAHOO_FINANCE_DATA_DELAY_MINUTES", "MASSIVE_API_KEY", "MASSIVE_BASE_URL", "MASSIVE_DATA_DELAY_MINUTES", "FINNHUB_API_KEY", "FINNHUB_BASE_URL", "FINNHUB_DATA_DELAY_MINUTES", "FINVIZ_API_KEY", "FINVIZ_BASE_URL", "FINVIZ_DATA_DELAY_MINUTES") $defaults
Add-Section $out $known $map "ChatGPT Apps domain verification" @("OPENAI_APPS_CHALLENGE_TOKEN") $defaults

$extra = @($map.Keys | Where-Object { -not $known.ContainsKey($_) })
if ($extra.Count -gt 0) {
  $out.Add("") | Out-Null
  $out.Add("# Other values preserved from previous file") | Out-Null
  foreach ($key in $extra) {
    $out.Add("$key=$($map[$key])") | Out-Null
  }
}

Set-Content -LiteralPath $envPath -Value (($out -join [Environment]::NewLine).TrimStart() + [Environment]::NewLine) -Encoding UTF8
Write-Host "Formatted .env. No secret values were printed."
Write-Host "Backup: $backupPath"
Write-Status (Read-DotEnv $envPath)
