; Verhuizen naar de R5Mod-map (vanaf 4.0.5).
; Staat een installatie voor alle gebruikers nog in de oude standaardmap (C:\Program Files\R5 ModHub),
; dan zet de update de nieuwe versie in C:\Program Files\R5Mod\R5 ModHub. Dat gebeurt in de
; installer die als beheerder draait (na de UAC-vraag): de oude InstallLocation wordt uit het
; register gehaald, zodat electron-builder de nieuwe standaardmap (met menuCategory) kiest en de
; oude versie via haar eigen uninstaller uit de oude map verwijdert (map uit UninstallString).
; Een zelfgekozen map en installaties "alleen voor mij" blijven waar ze staan.
!macro customInit
  ${if} ${isUpdated}
  ${andIf} $installMode == "all"
  ${andIf} ${UAC_IsAdmin}
    ${if} $INSTDIR == "$PROGRAMFILES64\${APP_FILENAME}"
    ${orIf} $INSTDIR == "$PROGRAMFILES\${APP_FILENAME}"
      DeleteRegValue HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      StrCpy $INSTDIR "$PROGRAMFILES64\${MENU_FILENAME}\${APP_FILENAME}"
    ${endIf}
  ${endIf}
!macroend
