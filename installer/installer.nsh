!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef BUILD_UNINSTALLER
  Var NovaInstallDesktopShortcut
  Var NovaInstallStartMenuShortcut
  Var NovaDesktopShortcutControl
  Var NovaStartMenuShortcutControl
!endif

!macro customInit
  StrCpy $NovaInstallDesktopShortcut "1"
  StrCpy $NovaInstallStartMenuShortcut "1"
!macroend

!macro customWelcomePage
  !define MUI_ABORTWARNING
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Nova Browser"
  !define MUI_WELCOMEPAGE_TEXT "A modern, fast desktop browser.$\r$\n$\r$\nNova brings thoughtful search and real web browsing together in one calm, focused experience.$\r$\n$\r$\nYour browser profile stays on this PC and is kept when you uninstall unless you choose to remove it."
  !define MUI_FINISHPAGE_TITLE "Nova Browser is ready."
  !define MUI_FINISHPAGE_TEXT "Installation is complete. Launch Nova Browser to start exploring."
  !insertmacro MUI_PAGE_WELCOME

  !define MUI_PAGE_HEADER_TEXT "Make Nova feel at home"
  !define MUI_PAGE_HEADER_SUBTEXT "Choose which shortcuts to add. You can change them later."
  Page custom NovaOptionsPage NovaOptionsLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function NovaOptionsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 8u 100% 25u "Open Nova quickly from the places you use most."
  Pop $0
  ${NSD_CreateCheckbox} 0 48u 100% 18u "Create a desktop shortcut"
  Pop $NovaDesktopShortcutControl
  ${If} $NovaInstallDesktopShortcut == "1"
    ${NSD_Check} $NovaDesktopShortcutControl
  ${Else}
    ${NSD_Uncheck} $NovaDesktopShortcutControl
  ${EndIf}
  ${NSD_CreateCheckbox} 0 77u 100% 18u "Add Nova to the Start Menu"
  Pop $NovaStartMenuShortcutControl
  ${If} $NovaInstallStartMenuShortcut == "1"
    ${NSD_Check} $NovaStartMenuShortcutControl
  ${Else}
    ${NSD_Uncheck} $NovaStartMenuShortcutControl
  ${EndIf}
  ${NSD_CreateLabel} 0 118u 100% 32u "Nova installs for your Windows account by default. You can choose a different location on the next screen."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function NovaOptionsLeave
  ${NSD_GetState} $NovaDesktopShortcutControl $NovaInstallDesktopShortcut
  ${NSD_GetState} $NovaStartMenuShortcutControl $NovaInstallStartMenuShortcut
FunctionEnd
!endif

!macro customInstall
  Delete "$DESKTOP\Nova Browser.lnk"
  Delete "$SMPROGRAMS\Nova Browser\Nova Browser.lnk"
  RMDir "$SMPROGRAMS\Nova Browser"

  ${If} $NovaInstallDesktopShortcut == "1"
    CreateShortCut "$DESKTOP\Nova Browser.lnk" "$appExe" "" "$appExe" 0 SW_SHOWNORMAL "" "Browse with Nova"
  ${EndIf}
  ${If} $NovaInstallStartMenuShortcut == "1"
    CreateDirectory "$SMPROGRAMS\Nova Browser"
    CreateShortCut "$SMPROGRAMS\Nova Browser\Nova Browser.lnk" "$appExe" "" "$appExe" 0 SW_SHOWNORMAL "" "Browse with Nova"
  ${EndIf}
!macroend

!macro customUnWelcomePage
  !define MUI_UNWELCOMEPAGE_TITLE "Remove Nova Browser"
  !define MUI_UNWELCOMEPAGE_TEXT "This removes the Nova Browser application. Your profile data, including saved preferences and site data, stays on this PC unless you explicitly choose to remove it on the next screen."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInstall
  Delete "$DESKTOP\Nova Browser.lnk"
  Delete "$SMPROGRAMS\Nova Browser\Nova Browser.lnk"
  RMDir "$SMPROGRAMS\Nova Browser"
!macroend

!macro customUnInstallSection
  Section /o "Also remove Nova profile data (preferences and site data)" SEC_NOVA_REMOVE_PROFILE
    SetShellVarContext current
    RMDir /r "$APPDATA\Nova Browser"
    RMDir /r "$APPDATA\nova-browser"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  SectionEnd
!macroend
