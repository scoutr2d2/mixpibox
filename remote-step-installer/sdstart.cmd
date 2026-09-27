@echo off
REM ══════════════════════════════════════════════════════════════════════════
REM  MixPi-Karte schreiben — der Starter fuer Windows.
REM
REM  WOZU: `sdstart` (ohne Endung) ist ein bash-Skript. Windows kann damit
REM  nichts anfangen; ein Doppelklick oeffnet dort bestenfalls einen Editor.
REM
REM  ADMINISTRATORRECHTE: Eine SD-Karte roh zu beschreiben verlangt sie. Ohne
REM  sie bricht Windows mit „Zugriff verweigert" ab — und dagegen hilft kein
REM  Passwortfenster, sondern nur ein Neustart des Programms mit der rechten
REM  Maustaste als Administrator. Deshalb wird hier NACHGESEHEN und gesagt,
REM  was zu tun ist, statt mitten im Schreiben zu scheitern.
REM ══════════════════════════════════════════════════════════════════════════
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Ohne Administratorrechte laesst sich keine Karte beschreiben.
  echo   Bitte diese Datei mit der rechten Maustaste anklicken und
  echo   "Als Administrator ausfuehren" waehlen.
  echo.
  pause
  exit /b 1
)

REM Python suchen: erst der Windows-Starter `py`, dann `python`.
where py >nul 2>&1 && (
  py -3 "%~dp0controller\sdstart.py" %*
  goto :ende
)
where python >nul 2>&1 && (
  python "%~dp0controller\sdstart.py" %*
  goto :ende
)
echo.
echo   Python wurde nicht gefunden. Bitte von python.org installieren
echo   (beim Installieren "Add python.exe to PATH" ankreuzen).
echo.
pause
exit /b 1

:ende
endlocal
