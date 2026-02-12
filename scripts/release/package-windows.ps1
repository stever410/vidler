param(
  [string]$OutputDir = "release-assets"
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$outputPath = Join-Path $rootDir $OutputDir
$stagingDir = Join-Path $rootDir ".tmp\windows-installer"
$appDir = Join-Path $stagingDir "app"
$issPath = Join-Path $stagingDir "vidler.iss"

if (Test-Path $stagingDir) {
  Remove-Item -Path $stagingDir -Recurse -Force
}
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$version = (Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json).version

Copy-Item -Path (Join-Path $rootDir "dist") -Destination (Join-Path $appDir "dist") -Recurse -Force
Copy-Item -Path (Join-Path $rootDir "package.json") -Destination $appDir -Force
Copy-Item -Path (Join-Path $rootDir "README.md") -Destination $appDir -Force

Push-Location $appDir
npm install --omit=dev --no-audit --no-fund
Pop-Location

$launcher = @'
@echo off
node "%~dp0dist\cli.js" %*
'@
Set-Content -Path (Join-Path $appDir "vidler.cmd") -Value $launcher -NoNewline

$escapedSourceDir = $appDir -replace "\\", "\\"
$escapedOutputDir = $outputPath -replace "\\", "\\"

$iss = @"
[Setup]
AppId=com.vidler.cli
AppName=Vidler
AppVersion=$version
DefaultDirName={autopf}\Vidler
DefaultGroupName=Vidler
OutputDir=$escapedOutputDir
OutputBaseFilename=vidler-Windows-setup
Compression=lzma
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Files]
Source: "$escapedSourceDir\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Vidler"; Filename: "{app}\vidler.cmd"

[Run]
Filename: "{cmd}"; Parameters: "/C ""{app}\vidler.cmd"" --help"; Flags: postinstall skipifsilent
"@

Set-Content -Path $issPath -Value $iss -NoNewline

$iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) {
  throw "Inno Setup was not found at $iscc"
}

& $iscc $issPath | Out-Host

$installer = Get-ChildItem -Path $outputPath -Recurse -Filter "vidler-Windows-setup*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No Windows installer was produced by Inno Setup."
}

$normalizedOutput = Join-Path $outputPath "vidler-Windows-setup.exe"
if ($installer.FullName -ne $normalizedOutput) {
  Copy-Item -Path $installer.FullName -Destination $normalizedOutput -Force
}
