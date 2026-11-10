[CmdletBinding()]
param(
    [Parameter(Mandatory)][switch]$DisposableVm,
    [Parameter(Mandatory)][string]$Output
)

$ErrorActionPreference = 'Stop'
if (-not $DisposableVm) { throw 'Run this inventory only in the disposable Windows x64 VM.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }

$installRoot = Join-Path $env:LOCALAPPDATA 'com.xneonlauncher.app'
$profileRoot = Join-Path $env:APPDATA 'xneonlauncher'
$registryPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = foreach ($registryPath in $registryPaths) {
    Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*Xneon Launcher*' } |
        Select-Object PSPath, DisplayName, DisplayVersion, InstallLocation, UninstallString
}
$shortcutRoots = @(
    [Environment]::GetFolderPath('Desktop')
    [Environment]::GetFolderPath('CommonDesktopDirectory')
    [Environment]::GetFolderPath('Programs')
    [Environment]::GetFolderPath('CommonPrograms')
)
$shortcuts = foreach ($shortcutRoot in $shortcutRoots) {
    Get-ChildItem -LiteralPath $shortcutRoot -Filter '*Xneon*.lnk' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
}
$channels = foreach ($channel in 'stable', 'canary') {
    $app = Join-Path $installRoot "$channel\app"
    $versionFile = Join-Path $app 'Resources\version.json'
    $binary = Join-Path $app 'bin\launcher.exe'
    [pscustomobject]@{
        Channel = $channel
        Version = if (Test-Path -LiteralPath $versionFile) {
            Get-Content -Raw -LiteralPath $versionFile | ConvertFrom-Json | Select-Object version, hash, channel, identifier
        }
        LauncherSha256 = if (Test-Path -LiteralPath $binary) {
            (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
        }
        AccessRules = if (Test-Path -LiteralPath $app) { (Get-Acl -LiteralPath $app).Sddl }
    }
}
[pscustomobject]@{
    Timestamp = Get-Date -Format o
    Channels = @($channels)
    Registry = @($entries)
    Shortcuts = @($shortcuts)
    ProfileExists = Test-Path -LiteralPath $profileRoot
    DatabaseExists = Test-Path -LiteralPath (Join-Path $profileRoot 'data.db')
    Processes = @(Get-Process launcher, msedgewebview2 -ErrorAction SilentlyContinue |
        Select-Object Id, ProcessName, Path)
} | ConvertTo-Json -Depth 7 | Set-Content -Encoding UTF8 -LiteralPath $Output
