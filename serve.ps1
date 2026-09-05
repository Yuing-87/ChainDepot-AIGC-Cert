# ChainVault zero-dependency static server (PowerShell only, no Node/Python).
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 [-Port 8123] [-Open]
param([int]$Port = 8123, [switch]$Open)
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
if ($Open) {
  Start-Sleep -Milliseconds 600
  Start-Process "http://localhost:$Port/"
}
Write-Host ""
Write-Host "  ChainVault static server started" -ForegroundColor Green
Write-Host "  Open: http://localhost:$Port/" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""
$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8'; '.svg'='image/svg+xml'; '.png'='image/png'
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.json'='application/json'
  '.txt'='text/plain; charset=utf-8'; '.ico'='image/x-icon'; '.woff2'='font/woff2'
}
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = $req.Url.AbsolutePath
    if ($path -eq '/') { $path = '/index.html' }
    $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $fp = [IO.Path]::GetFullPath((Join-Path $root $rel))
    $rootFull = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
    if (-not $fp.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
      $res.StatusCode = 403
    } elseif (Test-Path -LiteralPath $fp) {
      $bytes = [IO.File]::ReadAllBytes($fp)
      $ext = [IO.Path]::GetExtension($fp).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] } else { $res.ContentType = 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
  } catch {
    $res.StatusCode = 500
  }
  try { $res.OutputStream.Close() } catch {}
}
