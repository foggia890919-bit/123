# ePharms stock -> Supabase upload (calls sync_ephar_stock RPC)
# Prereq: epharms_extract.ps1 made stock_live.csv + bot_config.json has service_role key
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

function MkStr([int[]]$c){ -join ($c | ForEach-Object {[char]$_}) }
$W_DISCOUNT = MkStr @(0xD560,0xC778)        # 할인 (discount line)
$W_FEE      = MkStr @(0xC218,0xC218,0xB8CC) # 수수료 (fee line)
$W_BANNER   = MkStr @(0xBC30,0xB108)        # 배너 (banner)

$cfgPath = Join-Path $env:USERPROFILE 'sales\bot_config.json'
$cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$url = $cfg.supabase_url.TrimEnd('/')
$key = $cfg.service_role_key
if ([string]::IsNullOrWhiteSpace($key) -or $key -like 'PASTE*') {
  Write-Output 'ERR: put service_role_key in bot_config.json first'; return
}

$csv = Join-Path $env:USERPROFILE 'sales\stock_live.csv'
$rows = Import-Csv -LiteralPath $csv
$payload = @()
$skipped = 0
foreach ($r in $rows) {
  $nm = [string]$r.name
  if ($nm.Contains($W_DISCOUNT) -or $nm.Contains($W_FEE) -or $nm.Contains($W_BANNER)) { $skipped++; continue }  # skip settlement rows
  $st = 0; [int]::TryParse(([string]$r.stock -replace '[^0-9-]',''), [ref]$st) | Out-Null
  $payload += [ordered]@{
    code  = [string]$r.code
    name  = $nm
    spec  = [string]$r.spec
    maker = [string]$r.maker
    kind  = [string]$r.kind
    stock = $st
  }
}
Write-Output ("rows to send = " + $payload.Count + " (skipped settlement rows = " + $skipped + ")")

$body = @{ p_rows = $payload } | ConvertTo-Json -Depth 6 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
# new sb_secret_ key: send on apikey header ONLY (not Authorization Bearer — it is not a JWT)
# and use a non-browser User-Agent (Supabase blocks secret keys when UA looks like a browser/Mozilla)
$headers = @{ apikey = $key }
$endpoint = $url + '/rest/v1/rpc/sync_ephar_stock'

try {
  $resp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $bytes -UserAgent 'ykpharm-stock-bot/1.0'
  Write-Output ('RESULT: ' + ($resp | ConvertTo-Json -Compress))
} catch {
  Write-Output ('ERR: upload failed -> ' + $_.Exception.Message)
  if ($_.ErrorDetails) { Write-Output $_.ErrorDetails.Message }
}
