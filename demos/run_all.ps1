# Windows demo runner. Mirrors demos/run_all.sh: validate + plan every example,
# scaffold every profile, run doctor, and exercise the session lifecycle.
# Needs no ffmpeg (falls back to a stand-in process). Exits 0 on success.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cli = "node `"$root\dist\cli.js`""

if (-not (Test-Path "$root\dist\cli.js")) {
  Write-Host "== building (dist/ missing) =="
  Push-Location $root; npm run build; Pop-Location
}

Write-Host "== version =="
Invoke-Expression "$cli --version"

Get-ChildItem "$root\examples\*.json" | ForEach-Object {
  Write-Host "`n== validate + plan $($_.Name) =="
  Invoke-Expression "$cli validate `"$($_.FullName)`""
  Invoke-Expression "$cli plan `"$($_.FullName)`""
}

foreach ($p in @("multicast", "transcode", "srt", "testsrc")) {
  Write-Host "`n== scaffold profile: $p =="
  $out = Join-Path $env:TEMP "sr-$p.json"
  if (Test-Path $out) { Remove-Item $out -Force }
  Invoke-Expression "$cli new `"$p-relay`" --profile $p --out `"$out`""
  Invoke-Expression "$cli validate `"$out`""
  Remove-Item $out -Force
}

Write-Host "`n== doctor (ffmpeg optional) =="
try { Invoke-Expression "$cli doctor" } catch { }

Write-Host "`n== session lifecycle (stand-in process) =="
$state = Join-Path $env:TEMP "sr-demo-state.json"
$relay = Join-Path $env:TEMP "sr-demo-relay.json"
if (Test-Path $state) { Remove-Item $state -Force }
@'
{ "name": "demo", "ffmpegPath": "node",
  "input": { "url": "rtmp://localhost/live" },
  "outputs": [ { "name": "o", "url": "rtmp://dst/app/k" } ] }
'@ | Out-File -FilePath $relay -Encoding utf8
Invoke-Expression "$cli start demo --config `"$relay`" --state `"$state`""
Invoke-Expression "$cli status --state `"$state`""
Invoke-Expression "$cli stop demo --state `"$state`""
Remove-Item $state, $relay -Force -ErrorAction SilentlyContinue

Write-Host "`nALL DEMOS OK"
