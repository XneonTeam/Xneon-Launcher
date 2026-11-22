; Xneon Launcher — Windows NSIS installer.
;
; Ставит приложение в тот же пользовательский каталог, что и Electron-сборка:
;   %LOCALAPPDATA%\Programs\xneon-launcher
;
; Обновления Windows ставит собственный подписанный канал лаунчера
; (Ed25519 + SHA-256 → этот же NSIS в тихом режиме). Нативное ядро Electrobun
; на Windows не используется: оно требует каталог
;   %LOCALAPPDATA%\<identifier>\<channel>
; (см. resolveInstalledChannelRoot в Updater SDK) и отвергает любой другой путь.
; Поэтому junction больше не создаётся, ярлыки и xneon:// запускают
; $INSTDIR\app\bin\launcher.exe напрямую. Старые junction прежних установок
; снимаются при установке и удалении.
;
; Параметры передаются из scripts/build-windows-distribution.ts:
;   /DOUTFILE=... /DSTAGING=... /DAPP_ICON=... /DAPP_VERSION=... /DAPP_FILE_VERSION=...

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
ShowInstDetails nevershow
ShowUninstDetails nevershow

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

!ifndef OUTFILE
  !error "OUTFILE is required"
!endif
!ifndef STAGING
  !error "STAGING is required"
!endif
!ifndef APP_ICON
  !define APP_ICON "icon.ico"
!endif
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!ifndef APP_FILE_VERSION
  !define APP_FILE_VERSION "0.0.0.0"
!endif
!ifndef APP_ID
  !define APP_ID "org.xneon.launcher"
!endif
; Прежний идентификатор (до 1.0.8): от него остались каталог управляемых
; обновлений, junction и ключ в «Установленные приложения».
!ifndef LEGACY_APP_ID
  !define LEGACY_APP_ID "com.xneonlauncher.app"
!endif
!ifndef CHANNEL
  !define CHANNEL "stable"
!endif

; Значения по умолчанию совпадают с Electron-сборкой; переопределяются только
; на время локальной проверки установщика (/DPRODUCT_NAME=..., /DINSTALL_DIR=...),
; штатная сборка из scripts/build-windows-distribution.ts их не передаёт.
!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "Xneon Launcher"
!endif
!ifndef INSTALL_DIR
  !define INSTALL_DIR "$LOCALAPPDATA\Programs\xneon-launcher"
!endif
!ifndef SCHEME_KEY
  !define SCHEME_KEY "Software\Classes\xneon"
!endif

!define PRODUCT_PUBLISHER "Xneon Launcher"
!define PRODUCT_URL "https://launcher.xneon.org"
!define UNINSTALL_EXE "Uninstall ${PRODUCT_NAME}.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define MANAGED_CHANNEL_ROOT "$LOCALAPPDATA\${APP_ID}\${CHANNEL}"
!define LAUNCH_EXE "$INSTDIR\app\bin\launcher.exe"

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
BrandingText "${PRODUCT_NAME}"
RequestExecutionLevel user
InstallDir "${INSTALL_DIR}"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "${LAUNCH_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить ${PRODUCT_NAME}"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${APP_FILE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey /LANG=1033 "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright ${PRODUCT_PUBLISHER}"

Function .onInit
  ; Per-user установка: ярлыки и «Установленные приложения» — в профиль
  ; текущего пользователя, без запроса UAC.
  SetShellVarContext current
FunctionEnd

; ---------------------------------------------------------------------------
; Закрываем запущенный лаунчер: и Electron-версию, и Electrobun-версию —
; окно у обеих называется «Xneon Launcher».
; Один макрос на инсталлятор и деинсталлятор: тело функции вызывается
; в обеих сборках.
; ---------------------------------------------------------------------------
!macro CloseRunningLauncher reason
  FindWindow $0 "" "${PRODUCT_NAME}"
  ${If} $0 == 0
    Return
  ${EndIf}
  ; +3 — пропустить MessageBox и Abort: тихая установка закрывает окно сама.
  IfSilent +3
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCT_NAME} запущен. ${reason}" IDOK +2
  Abort
  FindWindow $0 "" "${PRODUCT_NAME}"
  SendMessage $0 ${WM_CLOSE} 0 0 /TIMEOUT=3000
  StrCpy $1 0
  ${Do}
    Sleep 500
    FindWindow $0 "" "${PRODUCT_NAME}"
    ${If} $0 == 0
      ${ExitDo}
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $1 >= 20
      ${ExitDo}
    ${EndIf}
  ${Loop}
  FindWindow $0 "" "${PRODUCT_NAME}"
  ${If} $0 != 0
    System::Call 'user32::GetWindowThreadProcessId(p $0, *i .r2)'
    nsExec::ExecToStack 'taskkill /F /PID $2'
    Pop $3
    Pop $4
  ${EndIf}
!macroend

Function CloseRunningLauncher
  !insertmacro CloseRunningLauncher "Для установки он будет закрыт."
FunctionEnd

Function un.CloseRunningLauncher
  !insertmacro CloseRunningLauncher "Для удаления он будет закрыт."
FunctionEnd

; ---------------------------------------------------------------------------
; Освобождаем управляемый каталог Electrobun, оставшийся от прежних версий:
;  * junction на $INSTDIR — убираем только ссылку, файлы установки не трогаем;
;  * прежняя установка через Setup Electrobun — снимаем её штатным менеджером
;    (данные в %APPDATA%\xneonlauncher не удаляются).
; Новый установщик junction не создаёт.
; ---------------------------------------------------------------------------
Function ClearManagedChannelRoot
  StrCpy $0 "${MANAGED_CHANNEL_ROOT}"
  ${If} ${FileExists} "$0\uninstall.exe"
  ${AndIf} ${FileExists} "$0\.electrobun-uninstall.json"
    ExecWait '"$0\uninstall.exe" --uninstall --quiet'
    StrCpy $1 0
    ${Do}
      Sleep 500
      ${IfNot} ${FileExists} "$0\.electrobun-uninstall.json"
        ${ExitDo}
      ${EndIf}
      IntOp $1 $1 + 1
      ${If} $1 >= 120
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}
  ; rmdir без /s снимает junction и пустой каталог, но не заходит внутрь
  ; реального каталога; RMDir /r через junction мог бы удалить $INSTDIR.
  nsExec::ExecToStack 'cmd /c rmdir "$0"'
  Pop $2
  Pop $3
  ${If} ${FileExists} "$0\*.*"
    RMDir /r "$0"
  ${EndIf}
  ; Второй канал мог остаться junction'ом от прежней раскладки: снимаем только
  ; ссылку/пустой каталог, реальную установку другого канала не трогаем.
  !if "${CHANNEL}" == "stable"
    StrCpy $0 "$LOCALAPPDATA\${APP_ID}\canary"
  !else
    StrCpy $0 "$LOCALAPPDATA\${APP_ID}\stable"
  !endif
  nsExec::ExecToStack 'cmd /c rmdir "$0"'
  Pop $2
  Pop $3
  RMDir "$LOCALAPPDATA\${APP_ID}"
FunctionEnd

; ---------------------------------------------------------------------------
; Убираем следы прежнего идентификатора com.xneonlauncher.app: его каталог
; управляемых обновлений (там может быть junction на текущий $INSTDIR или
; реальная установка Electrobun), ключ «Установленных приложений» и остатки
; старых каналов. Данные в %APPDATA%\xneonlauncher не затрагиваются.
; ---------------------------------------------------------------------------
Function ClearLegacyAppId
  StrCpy $0 "$LOCALAPPDATA\${LEGACY_APP_ID}\${CHANNEL}"
  ${If} ${FileExists} "$0\uninstall.exe"
  ${AndIf} ${FileExists} "$0\.electrobun-uninstall.json"
    ExecWait '"$0\uninstall.exe" --uninstall --quiet'
    StrCpy $1 0
    ${Do}
      Sleep 500
      ${IfNot} ${FileExists} "$0\.electrobun-uninstall.json"
        ${ExitDo}
      ${EndIf}
      IntOp $1 $1 + 1
      ${If} $1 >= 120
        ${ExitDo}
      ${EndIf}
    ${Loop}
  ${EndIf}
  ; Сначала снимаем junction/пустой каталог: рекурсивное удаление сквозь
  ; ссылку ушло бы в каталог установки.
  nsExec::ExecToStack 'cmd /c rmdir "$0"'
  Pop $2
  Pop $3
  RMDir /r "$LOCALAPPDATA\${LEGACY_APP_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_APP_ID}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_APP_ID}.stable"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_APP_ID}.canary"
FunctionEnd

; ---------------------------------------------------------------------------
; Записи Electron-установщика (NSIS + electron-builder): ключ удаления с тем же
; DisplayName и обработчик схемы xneon://, который Electron-сборка оставляла.
; ---------------------------------------------------------------------------
Function RemoveLegacyEntries
  StrCpy $R0 0
  StrCpy $R1 0
  ${Do}
    EnumRegKey $R2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R0
    ${If} $R2 == ""
      ${ExitDo}
    ${EndIf}
    StrCpy $R3 ""
    ReadRegStr $R3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2" "DisplayName"
    StrCpy $R4 $R3 14
    ${If} $R2 != "${APP_ID}"
    ${AndIf} $R4 == "${PRODUCT_NAME}"
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R2"
    ${Else}
      IntOp $R0 $R0 + 1
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 2000
      ${ExitDo}
    ${EndIf}
  ${Loop}
  DeleteRegKey HKCU "${SCHEME_KEY}"
FunctionEnd

; ---------------------------------------------------------------------------
; Ярлыки запускают бандл прямо из $INSTDIR: junction управляемого канала
; больше не нужен, поэтому путь установки не подменяется ссылкой.
; ---------------------------------------------------------------------------
Function CreateShortcuts
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}.lnk" "${LAUNCH_EXE}" "" "${LAUNCH_EXE}" 0 SW_SHOWNORMAL "" "${PRODUCT_NAME}"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "${LAUNCH_EXE}" "" "${LAUNCH_EXE}" 0 SW_SHOWNORMAL "" "${PRODUCT_NAME}"
FunctionEnd

; ---------------------------------------------------------------------------
; Чистим корень установки от файлов прежней Electron-сборки: она ставила
; xneon-launcher.exe, resources\, locales\ и dll прямо в $INSTDIR, а новая
; раскладка — $INSTDIR\app\{bin,Resources}. Сохраняем только свой бандл,
; профиль WebView2 (куки встроенного браузера) и деинсталлятор, который
; удаляется отдельно перед распаковкой.
; ---------------------------------------------------------------------------
Function ClearLegacyInstallRoot
  ${IfNot} ${FileExists} "$INSTDIR\*.*"
    Return
  ${EndIf}
  FindFirst $0 $1 "$INSTDIR\*.*"
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
    ${AndIf} $1 != "app"
    ${AndIf} $1 != "WebView2"
    ${AndIf} $1 != "${UNINSTALL_EXE}"
      ${If} ${FileExists} "$INSTDIR\$1\*.*"
        ; junction снимаем без захода внутрь: RMDir /r сквозь ссылку удалил бы
        ; содержимое каталога, на который она указывает.
        nsExec::ExecToStack 'cmd /c rmdir "$INSTDIR\$1"'
        Pop $2
        Pop $2
        ${If} ${FileExists} "$INSTDIR\$1\*.*"
          RMDir /r "$INSTDIR\$1"
        ${EndIf}
      ${Else}
        Delete "$INSTDIR\$1"
      ${EndIf}
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
FunctionEnd

; ---------------------------------------------------------------------------
; Обработчик схемы xneon:// — как его оставляла Electron-сборка (per-user):
; ключ в HKCU и запуск лаунчера из $INSTDIR.
; ---------------------------------------------------------------------------
Function WriteSchemeRegistry
  WriteRegStr HKCU "${SCHEME_KEY}" "" "URL:Xneon Protocol"
  WriteRegStr HKCU "${SCHEME_KEY}" "URL Protocol" ""
  WriteRegStr HKCU "${SCHEME_KEY}\DefaultIcon" "" "${LAUNCH_EXE},0"
  WriteRegStr HKCU "${SCHEME_KEY}\shell\open\command" "" '"${LAUNCH_EXE}" "%1"'
FunctionEnd

; ---------------------------------------------------------------------------
; Автозапуск после обновления. electron-updater вызывает
; quitAndInstall(false, true) и передаёт «--updated --force-run»: после тихой
; установки лаунчер нужно запустить самим (страницу финиша в /S не показывают).
; Аргумент «--package-file=...» относится к скачанному установщику и приложению
; не нужен — просто игнорируем его.
; ---------------------------------------------------------------------------
Function RunLauncherIfRequested
  ${GetParameters} $R0
  ${GetOptions} $R0 "--force-run" $R1
  ${If} ${Errors}
    Return
  ${EndIf}
  ${If} ${Silent}
    Exec '"${LAUNCH_EXE}"'
  ${EndIf}
FunctionEnd

Function WriteUninstallRegistry
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\bin\launcher.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${PRODUCT_URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALL_EXE}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALL_EXE}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
FunctionEnd

Section "Install"
  Call CloseRunningLauncher
  ; Смену канала приложение запускает само и завершается параллельно с нами.
  ; Ждём его выхода, иначе RMDir /r не удалит занятый бандл и останется смесь
  ; файлов двух каналов.
  ${If} ${Silent}
    Sleep 2500
  ${EndIf}
  Call ClearManagedChannelRoot
  Call ClearLegacyAppId
  ; Профиль WebView2 (куки встроенного браузера) лежит в $INSTDIR\WebView2:
  ; при обновлении и переустановке его сохраняем — как Electron держит сессию
  ; в %APPDATA%. Убираем только прежний бандл и старый деинсталлятор.
  Call ClearLegacyInstallRoot
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\${UNINSTALL_EXE}"
  Call RemoveLegacyEntries

  ; app\ — бандл Electrobun (bin + Resources) внутри каталога установки.
  SetOutPath "$INSTDIR\app"
  File /r "${STAGING}\app\*.*"

  WriteUninstaller "$INSTDIR\${UNINSTALL_EXE}"
  Call CreateShortcuts
  Call WriteSchemeRegistry
  Call WriteUninstallRegistry
  Call RunLauncherIfRequested
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Call un.CloseRunningLauncher

  Delete "$SMPROGRAMS\${PRODUCT_NAME}.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${SCHEME_KEY}"
  ; Следы прежней junction-раскладки: снимаем только ссылки/пустые каталоги,
  ; реальную установку другого канала не трогаем.
  nsExec::ExecToStack 'cmd /c rmdir "${MANAGED_CHANNEL_ROOT}"'
  Pop $0
  Pop $0
  !if "${CHANNEL}" == "stable"
    nsExec::ExecToStack 'cmd /c rmdir "$LOCALAPPDATA\${APP_ID}\canary"'
  !else
    nsExec::ExecToStack 'cmd /c rmdir "$LOCALAPPDATA\${APP_ID}\stable"'
  !endif
  Pop $0
  Pop $0
  RMDir "$LOCALAPPDATA\${APP_ID}"

  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR"
SectionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd
