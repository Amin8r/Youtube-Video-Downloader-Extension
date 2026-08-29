$ErrorActionPreference = 'Stop'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $env:LOCALAPPDATA 'VMYtDlp'
$ConfigRoot = Join-Path $env:APPDATA 'vm-yt-dlp'
$ConfigFile = Join-Path $ConfigRoot 'config.json'
$VenvRoot = Join-Path $AppRoot 'venv'
$VenvPython = Join-Path $VenvRoot 'Scripts\python.exe'
$BridgeFile = Join-Path $AppRoot 'vm_ytdlp_bridge.py'
$Template = Join-Path $ScriptRoot 'userscript\yt-dlp-for-violentmonkey.user.js'
$PairedScript = Join-Path $ScriptRoot 'yt-dlp-for-violentmonkey.paired.user.js'
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupFile = Join-Path $StartupDir 'VMYtDlpBridge.cmd'

Write-Host "`nyt-dlp for Violentmonkey" -ForegroundColor White
Write-Host 'Secure local bridge installer · Windows' -ForegroundColor DarkGray

$PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($PythonLauncher) {
    & py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }
    New-Item -ItemType Directory -Force -Path $AppRoot, $ConfigRoot | Out-Null
    & py -3 -m venv $VenvRoot
} else {
    $Python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $Python) { throw 'Python 3.10 or newer was not found.' }
    & python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 or newer is required.' }
    New-Item -ItemType Directory -Force -Path $AppRoot, $ConfigRoot | Out-Null
    & python -m venv $VenvRoot
}

Write-Host 'Installing yt-dlp…' -ForegroundColor Cyan
& $VenvPython -m pip install --disable-pip-version-check --upgrade pip 'yt-dlp[default]'
Copy-Item (Join-Path $ScriptRoot 'companion\vm_ytdlp_bridge.py') $BridgeFile -Force

& $VenvPython $BridgeFile --config $ConfigFile init `
    --download-dir (Join-Path $HOME 'Downloads\YouTube') `
    --userscript-template $Template `
    --userscript-output $PairedScript

$CommandLine = "@echo off`r`nstart `"VM yt-dlp Bridge`" /min `"$VenvPython`" `"$BridgeFile`" --config `"$ConfigFile`" serve`r`n"
Set-Content -Path $StartupFile -Value $CommandLine -Encoding Ascii
$BridgeArguments = "`"$BridgeFile`" --config `"$ConfigFile`" serve"
Start-Process -FilePath $VenvPython -ArgumentList $BridgeArguments -WindowStyle Hidden

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning 'ffmpeg is missing. Install it (for example with winget) before merging video or converting audio.'
}
if (-not (Get-Command deno -ErrorAction SilentlyContinue) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning 'Install Deno or Node.js for full YouTube support.'
}

Write-Host "`nInstallation complete." -ForegroundColor Green
Write-Host 'Import this private file into Violentmonkey:'
Write-Host "  $PairedScript" -ForegroundColor White
