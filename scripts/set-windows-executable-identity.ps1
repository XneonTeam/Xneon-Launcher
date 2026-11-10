param([Parameter(Mandatory)][string]$Wrapper)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class XneonVersionResource {
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32", EntryPoint = "FindResourceW", SetLastError = true)]
    static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32", SetLastError = true)]
    static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32", SetLastError = true)]
    static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32")]
    static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExistingResources);
    [DllImport("kernel32", EntryPoint = "UpdateResourceW", SetLastError = true)]
    static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr update, bool discard);

    delegate bool ResourceLanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);
    [DllImport("kernel32", EntryPoint = "EnumResourceLanguagesW", SetLastError = true)]
    static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, ResourceLanguageCallback callback, IntPtr parameter);

    public static void Copy(string source, string target) {
        var type = new IntPtr(16);
        var id = new IntPtr(1);
        var module = LoadLibraryEx(source, IntPtr.Zero, 2);
        if (module == IntPtr.Zero) throw new Win32Exception();
        byte[] data;
        try {
            var resource = FindResource(module, id, type);
            if (resource == IntPtr.Zero) throw new Win32Exception();
            var size = SizeofResource(module, resource);
            var loaded = LoadResource(module, resource);
            if (size == 0 || loaded == IntPtr.Zero) throw new Win32Exception();
            var pointer = LockResource(loaded);
            if (pointer == IntPtr.Zero) throw new InvalidOperationException("Cannot read version resource");
            data = new byte[size];
            Marshal.Copy(pointer, data, 0, (int)size);
        } finally { FreeLibrary(module); }

        var languages = new List<ushort>();
        var targetModule = LoadLibraryEx(target, IntPtr.Zero, 2);
        if (targetModule == IntPtr.Zero) throw new Win32Exception();
        try {
            ResourceLanguageCallback callback = (handle, resourceType, resourceName, language, parameter) => {
                languages.Add(language);
                return true;
            };
            EnumResourceLanguages(targetModule, type, id, callback, IntPtr.Zero);
            GC.KeepAlive(callback);
        } finally { FreeLibrary(targetModule); }

        var update = BeginUpdateResource(target, false);
        if (update == IntPtr.Zero) throw new Win32Exception();
        foreach (var language in languages) {
            if (!UpdateResource(update, type, id, language, null, 0)) {
                var error = new Win32Exception();
                EndUpdateResource(update, true);
                throw error;
            }
        }
        if (!UpdateResource(update, type, id, 1033, data, (uint)data.Length)) {
            var error = new Win32Exception();
            EndUpdateResource(update, true);
            throw error;
        }
        if (!EndUpdateResource(update, false)) throw new Win32Exception();
    }
}
"@

$project = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $project 'package.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-pre\d+)?$') { throw 'Invalid launcher version' }
$numericVersion = ($version -split '-')[0] + '.0'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$temporary = Join-Path $Wrapper "version-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporary | Out-Null
$source = Join-Path $temporary 'version.cs'
$files = @('bun.exe', 'launcher.exe')
try {
    @"
using System.Reflection;
[assembly: AssemblyTitle("Xneon Launcher")]
[assembly: AssemblyProduct("Xneon Launcher")]
[assembly: AssemblyCompany("Xneon Launcher")]
[assembly: AssemblyFileVersion("$numericVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $source -Encoding UTF8
    foreach ($file in $files) {
        $resource = Join-Path $temporary "Xneon Launcher.dll"
        & $compiler /nologo /target:library "/out:$resource" $source
        if ($LASTEXITCODE -ne 0) { throw 'Version resource compilation failed' }
        $target = Join-Path $Wrapper "bin/$file"
        [XneonVersionResource]::Copy($resource, $target)
        $identity = [Diagnostics.FileVersionInfo]::GetVersionInfo($target)
        if ($identity.FileDescription -ne 'Xneon Launcher' -or $identity.ProductName -ne 'Xneon Launcher' -or $identity.InternalName -ne 'Xneon Launcher.dll' -or $identity.OriginalFilename -ne 'Xneon Launcher.dll') {
            throw "Incorrect Windows metadata for $file"
        }
    }
} finally {
    Remove-Item -LiteralPath (Join-Path $temporary "Xneon Launcher.dll") -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $source -ErrorAction SilentlyContinue
    [IO.Directory]::Delete($temporary)
}
