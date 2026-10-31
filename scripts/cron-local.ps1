# Local cron simulator for dev server.
# Run in a separate PowerShell window alongside `npm run dev`.
#
# Schedules (mirrors production):
#   - process-screenings : every 1 minute
#   - expire-interviews  : every hour on the :00
#   - purge-original     : daily 03:30 (opt-in)
#
# Usage:
#   Terminal A: cd D:\intervia\interviewer; npm run dev
#   Terminal B: D:\intervia\interviewer\scripts\cron-local.ps1
#   Stop with Ctrl+C
#
# Requires dev server running on port 3003.

$BaseUrl = "http://localhost:3003"
# CRON_SECRET: 환경변수 우선, 없으면 .env.local 의 값을 읽는다 (토큰은 저장소에 두지 않음).
$Token = $env:CRON_SECRET
if (-not $Token) {
  $envFile = Join-Path $PSScriptRoot "..\.env.local"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } | Select-Object -First 1
    if ($line) { $Token = ($line -replace '^\s*CRON_SECRET\s*=\s*', '').Trim().Trim([char]34).Trim([char]39) }
  }
}
if (-not $Token) {
  Write-Host "CRON_SECRET 이 없습니다. `$env:CRON_SECRET 을 설정하거나 .env.local 에 CRON_SECRET 을 넣으세요." -ForegroundColor Red
  exit 1
}
$Headers = @{ Authorization = "Bearer $Token" }

# Set to $true to also simulate the daily PII purge cron locally.
$EnableDailyPurge = $false

function Invoke-Cron {
  param([string]$Name, [string]$Path)
  $ts = Get-Date -Format "HH:mm:ss"
  try {
    $start = Get-Date
    $res = Invoke-WebRequest -Uri "$BaseUrl$Path" -Method POST -Headers $Headers `
      -UseBasicParsing -TimeoutSec 90 -ErrorAction Stop
    $elapsed = [int]((Get-Date) - $start).TotalSeconds
    Write-Host "[$ts] $Name -> $($res.StatusCode) (${elapsed}s)" -ForegroundColor Green
  }
  catch {
    Write-Host "[$ts] $Name -> ERROR: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "===============================================" -ForegroundColor Cyan
Write-Host " Local cron simulator started" -ForegroundColor Cyan
Write-Host "   - process-screenings : every minute" -ForegroundColor Gray
Write-Host "   - expire-interviews  : every hour on :00" -ForegroundColor Gray
if ($EnableDailyPurge) {
  Write-Host "   - purge-original     : daily 03:30" -ForegroundColor Gray
}
Write-Host "   Stop: Ctrl+C" -ForegroundColor Yellow
Write-Host "===============================================" -ForegroundColor Cyan

# Initial tick on startup.
Invoke-Cron -Name "process-screenings (initial)" -Path "/api/cron/process-screenings"

while ($true) {
  # Sleep until the top of the next minute.
  $now = Get-Date
  $nextMinute = $now.AddSeconds(60 - $now.Second).AddMilliseconds(-$now.Millisecond)
  $waitMs = [int]($nextMinute - (Get-Date)).TotalMilliseconds
  if ($waitMs -gt 0) { Start-Sleep -Milliseconds $waitMs }

  $tick = Get-Date

  # Every minute: process-screenings
  Invoke-Cron -Name "process-screenings" -Path "/api/cron/process-screenings"

  # Top of each hour: expire-interviews
  if ($tick.Minute -eq 0) {
    Invoke-Cron -Name "expire-interviews" -Path "/api/cron/expire-interviews"
  }

  # Daily 03:30: purge-original (opt-in)
  if ($EnableDailyPurge -and $tick.Hour -eq 3 -and $tick.Minute -eq 30) {
    Invoke-Cron -Name "purge-original" -Path "/api/cron/purge-original"
  }
}
