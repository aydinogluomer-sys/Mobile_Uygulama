$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

Write-Host ''
Write-Host 'Atlas Supabase recovery template configurator' -ForegroundColor Cyan
Write-Host 'Token ekranda gösterilmez, dosyaya yazılmaz ve işlem sonunda bellekten temizlenir.' -ForegroundColor DarkGray
Write-Host ''

$secureToken = Read-Host 'Supabase Personal Access Token' -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
  $env:SUPABASE_ACCESS_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
  node scripts\configure-supabase-recovery-template.mjs --apply

  if ($LASTEXITCODE -ne 0) {
    throw "Template configuration failed with exit code $LASTEXITCODE."
  }

  Write-Host ''
  Write-Host 'Başarılı: Yeni recovery e-postaları 6 haneli kod içerecek.' -ForegroundColor Green
  Write-Host 'Şimdi localhost:3002/forgot-password üzerinden YENİ bir kod isteyin.' -ForegroundColor Green
}
catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
}

Write-Host ''
Read-Host 'Pencereyi kapatmak için Enter'
