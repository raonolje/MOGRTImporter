Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
ManifestDPIAware true
Name "MOGRT Subtitle Importer ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$APPDATA\Adobe\CEP\extensions\CEP_MogrtImporter"
ShowInstDetails show
ShowUninstDetails show
BrandingText "MOGRT Subtitle Importer"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "MOGRT Subtitle Importer"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Per-user CEP extension installer"
VIAddVersionKey "LegalCopyright" "MOGRT Subtitle Importer contributors"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

Var DebugCheckbox
Var EnableDebug
Var DebugAlreadyEnabled
Var Dialog

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This installs MOGRT Subtitle Importer for the current Windows user.$\r$\n$\r$\nClose Adobe Premiere Pro before installing.$\r$\n$\r$\nExisting code and user cache are backed up outside the CEP extensions folder. Your cache is preserved, and installed files are verified with SHA-256.$\r$\n$\r$\nAdministrator access is not required."
!insertmacro MUI_PAGE_WELCOME
Page custom CepOptions CepOptionsLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "Installation and file verification completed.$\r$\n$\r$\nOpen Premiere Pro, then Window > Extensions > MOGRT Subtitle Importer.$\r$\n$\r$\nIf unsigned CEP mode is disabled, the panel may not appear. Run this installer again and select the unsigned CEP option.$\r$\n$\r$\nBackups: %APPDATA%\MOGRT_Importer_backup"
!insertmacro MUI_PAGE_FINISH
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Close Adobe Premiere Pro before uninstalling.$\r$\n$\r$\nOnly installed extension code will be removed. User cache, verified backups, and the shared unsigned CEP setting are preserved."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext current
  ; Keep the helper, files, and uninstall registration on the same per-user path, even with /D=.
  StrCpy $INSTDIR "$APPDATA\Adobe\CEP\extensions\CEP_MogrtImporter"
  StrCpy $EnableDebug 0
  StrCpy $DebugAlreadyEnabled 0
  ReadRegStr $0 HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode"
  ${If} $0 == "1"
    StrCpy $DebugAlreadyEnabled 1
  ${EndIf}
FunctionEnd

Function CepOptions
  !insertmacro MUI_HEADER_TEXT "Installation options" "Current user only; your cache is preserved."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 34u "Install location:$\r$\n$INSTDIR"
  Pop $0
  ${NSD_CreateCheckbox} 0 42u 100% 18u "Enable unsigned CEP extensions for this Windows user"
  Pop $DebugCheckbox
  ${NSD_CreateLabel} 0 66u 100% 47u "This sets only HKCU\Software\Adobe\CSXS.11\PlayerDebugMode = 1. It allows unsigned CEP extensions for Adobe CSXS 11, not just this panel. The shared setting is preserved when uninstalling."
  Pop $0
  ${If} $DebugAlreadyEnabled == 1
    ${NSD_Check} $DebugCheckbox
    EnableWindow $DebugCheckbox 0
    ${NSD_CreateLabel} 0 119u 100% 24u "Unsigned CEP mode is already enabled. The setting will be left unchanged."
    Pop $0
  ${Else}
    ${NSD_CreateLabel} 0 119u 100% 24u "Unchecked by default: the panel may not appear until unsigned CEP mode is enabled."
    Pop $0
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function CepOptionsLeave
  StrCpy $EnableDebug 0
  ${If} $DebugAlreadyEnabled != 1
    ${NSD_GetState} $DebugCheckbox $EnableDebug
  ${EndIf}
FunctionEnd

Section "Install"
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\payload"
  File /r "${PAYLOAD}\*"
  SetOutPath "$PLUGINSDIR"
  File /oname=installer-engine.ps1 "${SOURCE}\installer-engine.ps1"
  StrCpy $1 ""
  ${If} $EnableDebug == 1
    StrCpy $1 " -EnableUnsignedCep"
  ${EndIf}
  DetailPrint "Checking Premiere, backing up existing files, and verifying installation..."
  ; Bypass is scoped to this child process. No machine/user execution policy is changed.
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-engine.ps1" -Action Install -PayloadPath "$PLUGINSDIR\payload"$1'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Installation stopped. See the details above. Close Premiere Pro and check that the backup/install folders are writable." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  SetOutPath "$INSTDIR"
  ClearErrors
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "Extension files were installed, but the uninstaller could not be written. Run the installer again after checking folder permissions." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "DisplayName" "MOGRT Subtitle Importer"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "Publisher" "RAONOLJE"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "UninstallString" '$"$INSTDIR\Uninstall.exe$"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "URLInfoAbout" "https://github.com/raonolje/MOGRTImporter"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter" "EstimatedSize" ${SIZE_KB}
SectionEnd

Function un.onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$APPDATA\Adobe\CEP\extensions\CEP_MogrtImporter"
FunctionEnd

Section "Uninstall"
  SetShellVarContext current
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=installer-engine.ps1 "${SOURCE}\installer-engine.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\installer-engine.ps1" -Action Uninstall'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Uninstall stopped. See the details above. User data has not been deleted." /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\MOGRTImporter"
  Delete "$INSTDIR\Uninstall.exe"
  ; No recursive delete: cache and unknown files remain available for reinstall/restore.
  RMDir "$INSTDIR"
SectionEnd
