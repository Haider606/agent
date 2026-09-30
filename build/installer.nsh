!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; Check if app is already running
  FindWindow $0 "Stocko Print Agent" ""
  StrCmp $0 0 +3
    MessageBox MB_OKCANCEL "Stocko Print Agent is currently running. Please close it before installing." IDOK +2
    Abort
!macroend

!macro customInstall
  ; Create a flag file so the app knows it's a fresh install
  FileOpen $0 "$INSTDIR\.fresh-install" w
  FileClose $0
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Run\StockoPrintAgent"
!macroend