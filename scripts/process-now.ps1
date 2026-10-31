# Manually trigger production screening queue + interview expiry.
# Use during beta to process the queue without cron-job.org.
# Usage: D:\intervia\interviewer\scripts\process-now.ps1

$BaseUrl = "https://intervia.kr"
# CRON_SECRET 은 저장소에 두지 않는다 — 실행 전 `$env:CRON_SECRET = "<운영 값>"` 으로 설정.
$Token = $env:CRON_SECRET
if (-not $Token) {
  Write-Host "CRON_SECRET 환경변수가 없습니다. 먼저 `$env:CRON_SECRET 을 설정하세요 (운영 값, Vercel 환경변수 참고)." -ForegroundColor Red
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
Write-Host "Done. Check Vercel Logs for details." -ForegroundColor Green
