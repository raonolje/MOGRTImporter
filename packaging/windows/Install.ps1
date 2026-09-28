# Run in Windows PowerShell 5.1 or newer. Installs for the current user; no administrator access needed.
[CmdletBinding()]
param([switch]$EnableUnsignedCep)
$ErrorActionPreference = 'Stop'
Write-Host 'Close Adobe Premiere Pro before continuing.'
Write-Host 'Existing code and cache will be backed up outside the CEP extensions folder.'
Write-Host 'The cache will be preserved and all installed files will be SHA-256 verified.'
if ($EnableUnsignedCep) {
    Write-Host 'Opt-in: set only HKCU\Software\Adobe\CSXS.11\PlayerDebugMode to 1 (unsigned CEP extensions for this user).'
} else {
    Write-Host 'Unsigned CEP mode will not be changed. If this panel does not appear, rerun with -EnableUnsignedCep.'
}
& (Join-Path $PSScriptRoot 'installer-engine.ps1') -Action Install -PayloadPath $PSScriptRoot -EnableUnsignedCep:$EnableUnsignedCep
exit $LASTEXITCODE
