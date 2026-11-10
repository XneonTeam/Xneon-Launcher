$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$release = Join-Path $project 'release-electrobun/stable'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$payload = Join-Path $release 'win-x64-XneonLauncher-Setup.zip'
$installer = Join-Path $release "$($package.name)-$($package.version)-win-x64.exe"
$icon = Join-Path $project 'build/icon.ico'
$source = Join-Path $project 'build/windows-installer.cs'
$compression = Join-Path $framework 'System.IO.Compression.dll'
$forms = Join-Path $framework 'System.Windows.Forms.dll'
$metadata = Join-Path $project "build-electrobun/installer-identity-$([guid]::NewGuid().ToString('N')).cs"
$fileVersion = ($package.version -split '[-+]', 2)[0] + '.0'

try {
    @"
using System.Reflection;
[assembly: AssemblyTitle("$($package.description)")]
[assembly: AssemblyProduct("Xneon Launcher")]
[assembly: AssemblyCompany("Xneon Launcher")]
[assembly: AssemblyCopyright("Copyright $([char]0x00a9) 2026 Xneon Launcher")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$($package.version)")]
"@ | Set-Content -LiteralPath $metadata -Encoding UTF8
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$installer" "/win32icon:$icon" "/resource:$payload,InstallerPayload" "/reference:$compression" "/reference:$forms" $source $metadata
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output "Single-file installer: $installer"
}
finally {
    Remove-Item -LiteralPath $metadata -ErrorAction SilentlyContinue
}
