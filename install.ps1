# Build streamrelay and expose the `streamrelay` command on your PATH (Windows).
# Requires Node.js >= 20. ffmpeg is the only external RUNTIME requirement.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Push-Location $root
try {
  Write-Host "== node version =="
  node --version

  Write-Host "== install deps (dev only; zero runtime deps) =="
  npm install

  Write-Host "== build =="
  npm run build

  Write-Host "== link CLI onto PATH =="
  npm link
  Write-Host "OK: run 'streamrelay --help' to get started."

  Write-Host "`nChecking ffmpeg (the only external runtime requirement):"
  try { streamrelay doctor } catch {
    Write-Host "  (install ffmpeg to actually start relays: winget install Gyan.FFmpeg)"
  }
} finally {
  Pop-Location
}
