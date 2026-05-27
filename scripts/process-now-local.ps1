# Manually trigger local dev server screening queue + interview expiry.
# Usage: D:\intervia\interviewer\scripts\process-now-local.ps1
# Requires: `npm run dev` running on port 3003 in another terminal.

$BaseUrl = "http://localhost:3003"
$Token   = "416682340d1d8d0c4b7b2cae3dade7896c5729b52ee5885dfd98e05058f4b16a"

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
