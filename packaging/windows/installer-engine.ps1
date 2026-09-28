# Shared by the NSIS installer and the portable Install.ps1. Requires Windows PowerShell 5.1.
[CmdletBinding()]
param(
    [ValidateSet('Install', 'Uninstall')][string]$Action = 'Install',
    [string]$PayloadPath = $PSScriptRoot,
    [string]$RoamingRoot = [Environment]::GetFolderPath('ApplicationData'),
    [switch]$EnableUnsignedCep
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-MogrtPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) { throw "An absolute path is required: $Path" }
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -eq [IO.Path]::GetPathRoot($full)) { return $full }
    return $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-MogrtPlainPath([string]$Path) {
    $cursor = Get-MogrtPath $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links/junctions are not supported in installation paths: $cursor" }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Get-MogrtFiles([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root)) { return }
    Assert-MogrtPlainPath $Root
    foreach ($item in Get-ChildItem -LiteralPath $Root -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Links/junctions are not supported: $($item.FullName)" }
        if ($item.PSIsContainer) { Get-MogrtFiles $item.FullName }
        else { $item }
    }
}

function Get-MogrtHashes([string]$Root) {
    $map = @{}
    $base = Get-MogrtPath $Root
    foreach ($file in @(Get-MogrtFiles $base)) {
        $rel = $file.FullName.Substring($base.Length + 1).Replace('\', '/')
        $map[$rel] = Get-MogrtFileHash $file.FullName
    }
    return $map
}

function Get-MogrtFileHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Assert-MogrtHashes($Actual, $Expected, [string]$Label) {
    if ($Actual.Count -ne $Expected.Count) { throw "$Label file count differs ($($Actual.Count) / $($Expected.Count))." }
    foreach ($key in $Expected.Keys) {
        if (-not $Actual.ContainsKey($key) -or $Actual[$key] -ne $Expected[$key]) { throw "$Label SHA-256 mismatch: $key" }
    }
}

function Test-MogrtRelativePath([string]$Path) {
    if (-not $Path -or $Path.Contains('\') -or $Path.Contains(':') -or $Path.StartsWith('/') -or $Path.EndsWith('/')) { return $false }
    foreach ($part in $Path.Split('/')) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>"|?*\x00-\x1f]' -or $part -match '[ .]$') { return $false }
        if ($part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { return $false }
    }
    if ($Path -match '^(?i:cache)(/|$)' -or $Path -match '^(?i:install\.receipt\.json|Uninstall\.exe)$') { return $false }
    return $true
}

function Read-MogrtHashManifest([string]$Path) {
    $obj = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $obj -or $obj -is [Array] -or $obj -is [string]) { throw 'Invalid file hash manifest.' }
    $map = @{}
    foreach ($property in $obj.PSObject.Properties) {
        if (-not (Test-MogrtRelativePath $property.Name) -or $property.Value -isnot [string] -or $property.Value -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid file manifest entry: $($property.Name)" }
        if ($map.ContainsKey($property.Name)) { throw "Duplicate file manifest entry: $($property.Name)" }
        $map[$property.Name] = $property.Value
    }
    if ($map.Count -eq 0) { throw 'Empty file hash manifest.' }
    return $map
}

function Get-MogrtLayout([string]$AppDataRoot) {
    $roaming = Get-MogrtPath $AppDataRoot
    Assert-MogrtPlainPath $roaming
    $extensions = Join-Path $roaming 'Adobe\CEP\extensions'
    $target = Join-Path $extensions 'CEP_MogrtImporter'
    $backup = Join-Path $roaming 'MOGRT_Importer_backup'
    Assert-MogrtPlainPath $target
    Assert-MogrtPlainPath $backup
    if ((Get-MogrtPath $backup).StartsWith((Get-MogrtPath $extensions) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The backup must be outside the CEP extensions directory.' }
    return @{ Target = $target; BackupRoot = $backup; Cache = Join-Path $target 'cache' }
}

function Assert-MogrtPremiereClosed {
    $running = @(Get-Process -ErrorAction Stop | Where-Object { $_.ProcessName -eq 'Adobe Premiere Pro' })
    if ($running.Count -gt 0) { throw 'Close Adobe Premiere Pro before installing or uninstalling. No application files were changed.' }
}

function Read-MogrtPayload([string]$Root) {
    $base = Get-MogrtPath $Root
    Assert-MogrtPlainPath $base
    $extension = Join-Path $base 'extension'
    $hashes = Read-MogrtHashManifest (Join-Path $base 'files.sha256.json')
    Assert-MogrtHashes (Get-MogrtHashes $extension) $hashes 'Release payload'
    foreach ($required in @('CSXS/manifest.xml', 'html/index.html', 'html/js/app.js', 'jsx/hostscript.jsx')) {
        if (-not $hashes.ContainsKey($required)) { throw "Missing release file: $required" }
    }
    $metadata = Get-Content -LiteralPath (Join-Path $base 'metadata.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($metadata.version -notmatch '^\d+\.\d+\.\d+$' -or $metadata.build -notmatch '^prod-[a-zA-Z0-9.-]+$') { throw 'Invalid production release metadata.' }
    [xml]$manifest = Get-Content -LiteralPath (Join-Path $extension 'CSXS\manifest.xml') -Raw -Encoding UTF8
    if ($manifest.ExtensionManifest.ExtensionBundleId -ne 'com.raonolje.mogrtimporter' -or $manifest.ExtensionManifest.ExtensionBundleVersion -ne $metadata.version) { throw 'The release manifest identity/version does not match.' }
    return @{ Root = $base; Extension = $extension; Hashes = $hashes; Metadata = $metadata }
}

function Copy-MogrtFile([string]$From, [string]$To) {
    Assert-MogrtPlainPath $To
    if (Test-Path -LiteralPath $To -PathType Container) { throw "A directory occupies the destination file path: $To" }
    $parent = [IO.Path]::GetDirectoryName($To)
    [void][IO.Directory]::CreateDirectory($parent)
    Copy-Item -LiteralPath $From -Destination $To -Force
}

function Backup-MogrtInstallation($Layout, [string]$ActionName) {
    $original = Get-MogrtHashes $Layout.Target
    $backup = Join-Path $Layout.BackupRoot ((Get-Date -Format 'yyyyMMdd_HHmmss_fff') + '_' + $ActionName + '_' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    [void][IO.Directory]::CreateDirectory((Join-Path $backup 'code'))
    [void][IO.Directory]::CreateDirectory((Join-Path $backup 'cache'))
    $code = @{}; $cache = @{}
    foreach ($rel in $original.Keys) {
        if ($rel.StartsWith('cache/', [StringComparison]::OrdinalIgnoreCase)) {
            $underCache = $rel.Substring(6)
            $cache[$underCache] = $original[$rel]
            Copy-MogrtFile (Join-Path $Layout.Target $rel) (Join-Path (Join-Path $backup 'cache') $underCache)
        } else {
            $code[$rel] = $original[$rel]
            Copy-MogrtFile (Join-Path $Layout.Target $rel) (Join-Path (Join-Path $backup 'code') $rel)
        }
    }
    Assert-MogrtHashes (Get-MogrtHashes (Join-Path $backup 'code')) $code 'Code backup'
    Assert-MogrtHashes (Get-MogrtHashes (Join-Path $backup 'cache')) $cache 'Cache backup'
    Assert-MogrtHashes (Get-MogrtHashes $Layout.Target) $original 'Installation changed during backup'
    Write-Host "Verified backup: $backup"
    return @{ Path = $backup; Original = $original; Cache = $cache; Code = $code }
}

function Set-MogrtUnsignedCep {
    $key = 'HKCU:\Software\Adobe\CSXS.11'
    [void](New-Item -Path $key -Force)
    [void](New-ItemProperty -LiteralPath $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force)
}

function Get-MogrtUnsignedCepSetting {
    $entry = Get-ItemProperty -LiteralPath 'HKCU:\Software\Adobe\CSXS.11' -Name PlayerDebugMode -ErrorAction SilentlyContinue
    if ($null -eq $entry) { return @{ exists = $false; value = $null } }
    return @{ exists = $true; value = $entry.PlayerDebugMode }
}

function Install-Mogrt([string]$Source, [string]$AppDataRoot, [bool]$EnableDebug = $false) {
    Assert-MogrtPremiereClosed
    $release = Read-MogrtPayload $Source
    $layout = Get-MogrtLayout $AppDataRoot
    foreach ($rel in $release.Hashes.Keys) {
        $dest = Join-Path $layout.Target $rel
        Assert-MogrtPlainPath $dest
        if (Test-Path -LiteralPath $dest -PathType Container) { throw "A directory occupies the destination file path: $dest" }
    }
    $existingManifest = Join-Path $layout.Target 'CSXS\manifest.xml'
    if (Test-Path -LiteralPath $existingManifest) {
        [xml]$oldManifest = Get-Content -LiteralPath $existingManifest -Raw -Encoding UTF8
        if ($oldManifest.ExtensionManifest.ExtensionBundleId -ne 'com.raonolje.mogrtimporter') { throw 'Another extension occupies the installation directory.' }
    }
    $backup = Backup-MogrtInstallation $layout 'install'
    Assert-MogrtPremiereClosed
    $written = New-Object 'System.Collections.Generic.List[string]'
    $receiptPath = Join-Path $layout.Target 'install.receipt.json'
    try {
        foreach ($rel in $release.Hashes.Keys) {
            $written.Add($rel)
            Copy-MogrtFile (Join-Path $release.Extension $rel) (Join-Path $layout.Target $rel)
        }
        foreach ($rel in $release.Hashes.Keys) {
            $actual = Get-MogrtFileHash (Join-Path $layout.Target $rel)
            if ($actual -ne $release.Hashes[$rel]) { throw "Installed SHA-256 mismatch: $rel" }
        }
        Assert-MogrtHashes (Get-MogrtHashes $layout.Cache) $backup.Cache 'User cache'
        $written.Add('install.receipt.json')
        $debugBefore = Get-MogrtUnsignedCepSetting
        $receipt = @{ schemaVersion = 1; version = $release.Metadata.version; build = $release.Metadata.build; installedAt = [DateTime]::UtcNow.ToString('o'); backup = $backup.Path; files = $release.Hashes; unsignedCepBefore = $debugBefore; unsignedCepOptIn = $EnableDebug }
        [IO.File]::WriteAllText($receiptPath, ($receipt | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        if ($EnableDebug -and [string]$debugBefore.value -ne '1') { Set-MogrtUnsignedCep }
        Write-Host "Installed MOGRT Subtitle Importer $($release.Metadata.version) ($($release.Metadata.build))."
        Write-Host "Location: $($layout.Target)"
        Write-Host 'User cache preserved and SHA-256 verified.'
        return @{ Target = $layout.Target; Backup = $backup.Path; Version = $release.Metadata.version; Build = $release.Metadata.build }
    } catch {
        $failure = $_
        foreach ($rel in $written) {
            $dest = Join-Path $layout.Target $rel
            if ($backup.Code.ContainsKey($rel)) { Copy-MogrtFile (Join-Path (Join-Path $backup.Path 'code') $rel) $dest }
            elseif (Test-Path -LiteralPath $dest -PathType Leaf) { Assert-MogrtPlainPath $dest; Remove-Item -LiteralPath $dest -Force }
        }
        Assert-MogrtHashes (Get-MogrtHashes $layout.Target) $backup.Original 'Rollback'
        throw "Installation failed; original code restored. Backup: $($backup.Path). $($failure.Exception.Message)"
    }
}

function Uninstall-Mogrt([string]$AppDataRoot) {
    Assert-MogrtPremiereClosed
    $layout = Get-MogrtLayout $AppDataRoot
    $receiptPath = Join-Path $layout.Target 'install.receipt.json'
    if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) { throw 'Installation receipt not found; no files were removed.' }
    $receipt = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($receipt.schemaVersion -ne 1 -or $null -eq $receipt.files) { throw 'Invalid installation receipt; no files were removed.' }
    $paths = @($receipt.files.PSObject.Properties.Name)
    foreach ($rel in $paths) { if (-not (Test-MogrtRelativePath $rel)) { throw "Invalid uninstall path: $rel" } }
    if ($paths -notcontains 'CSXS/manifest.xml') { throw 'Invalid installation receipt; no files were removed.' }
    $backup = Backup-MogrtInstallation $layout 'uninstall'
    Assert-MogrtPremiereClosed
    foreach ($rel in $paths) {
        $target = Join-Path $layout.Target $rel
        Assert-MogrtPlainPath $target
        if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
    }
    Remove-Item -LiteralPath $receiptPath -Force
    Assert-MogrtHashes (Get-MogrtHashes $layout.Cache) $backup.Cache 'User cache'
    Write-Host 'Extension code removed. User cache, backups, unknown files, and the shared CEP debug setting were preserved.'
    Write-Host "Saved user data: $($layout.Cache)"
    Write-Host "Verified backup: $($backup.Path)"
}

if ($MyInvocation.InvocationName -ne '.') {
    $mutex = $null; $locked = $false
    try {
        $mutex = New-Object Threading.Mutex($false, 'Local\MOGRTImporter.Setup')
        $locked = $mutex.WaitOne(0)
        if (-not $locked) { throw 'Another MOGRT Importer installation is running.' }
        if ($Action -eq 'Uninstall') { Uninstall-Mogrt $RoamingRoot }
        else { $null = Install-Mogrt $PayloadPath $RoamingRoot ([bool]$EnableUnsignedCep) }
        exit 0
    } catch {
        Write-Error $_ -ErrorAction Continue
        exit 1
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        if ($null -ne $mutex) { $mutex.Dispose() }
    }
}
