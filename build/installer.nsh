; Windows installer additions (electron-builder "nsis.include").
;
; Uninstalling asks whether the logbook, the QRZ login and the settings go
; too — the same choice the Mac app's own "Uninstall R2FEL-LOG…" offers. "No"
; is the default: an uninstall is often just the step before a reinstall.
; "Yes" sends the data folder to the Recycle Bin, not away for good, so a
; logbook removed by mistake can still be restored.
;
; Skipped when an update runs the old version's uninstaller (isUpdated) and
; in silent mode (/SD IDNO), where nobody is there to answer.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Удалить также журнал связей, логин QRZ и настройки R2FEL-LOG?$\r$\nОни будут перемещены в Корзину. Чтобы сохранить связи, нажмите «Нет» и сначала сделайте экспорт ADIF в программе.$\r$\n$\r$\nAlso remove the logbook, the QRZ login and the settings?$\r$\nThey go to the Recycle Bin. To keep your contacts, choose No and export ADIF from the app first." /SD IDNO IDNO r2felKeepData
      SetShellVarContext current
      nsExec::ExecToLog `powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName Microsoft.VisualBasic; if (Test-Path -LiteralPath '$APPDATA\R2FEL-LOG') { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('$APPDATA\R2FEL-LOG', 'OnlyErrorDialogs', 'SendToRecycleBin') }"`
      Pop $0
    r2felKeepData:
  ${endIf}
!macroend
