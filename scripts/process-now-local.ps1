# Manually trigger local dev server screening queue + interview expiry.
# Usage: D:\intervia\interviewer\scripts\process-now-local.ps1
# Requires: `npm run dev` running on port 3003 in another terminal.

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

Write-Host "[1/2] process-screenings ..." -ForegroundColor Cyan
$res1 = curl.exe -X POST "$BaseUrl/api/cron/process-screenings" `
  -H "Authorization: Bearer $Token" `
  -s -w "`nHTTP %{http_code} (%{time_total}s)`n"
Write-Host $res1

Write-Host ""
Write-Host "[2/2] expire-interviews ..." -ForegroundColor Cyan
$res2 = curl.exe -X POST "$BaseUrl/api/cron/expire-interviews" `
  -H "Authorization: Bearer $Token" `
  -s -w "`nHTTP %{http_code} (%{time_total}s)`n"
Write-Host $res2

Write-Host ""
Write-Host "Done. Check dev server console for details." -ForegroundColor Green
