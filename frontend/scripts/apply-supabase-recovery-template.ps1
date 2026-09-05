$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

Write-Host ''
Write-Host 'Aderyth Supabase auth e-posta şablonları' -ForegroundColor Cyan
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
  Write-Host 'Başarılı: Doğrulama ve kurtarma e-postaları Aderyth şablonuyla güncellendi.' -ForegroundColor Green
  Write-Host 'Şimdi uygulamadan YENİ bir kayıt ve YENİ bir kurtarma kodu isteyip postaları gözle doğrulayın.' -ForegroundColor Green
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
