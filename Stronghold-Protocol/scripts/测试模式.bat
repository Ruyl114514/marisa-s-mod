@echo off
setlocal
rem ===========================================================================
rem  TEST MODE launcher (added by the MOD) -- unlimited prep funds.
rem
rem  Usage: double-click, or   test-mode.bat [amount] [launcher options]
rem    test-mode.bat                      funds topped up to 9999, port 3001
rem    test-mode.bat 50000                funds topped up to 50000
rem    test-mode.bat 50000 --port 3000    ... and pass options on to launch.mjs
rem
rem  It listens on PORT 3001 by default, NOT the normal 3000: launch.mjs treats
rem  an already-answering port as "the server is running" and exits 0, which made
rem  this window vanish and opened the ORDINARY server (no test mode at all) when
rem  the game was already running. A separate port lets both run side by side.
rem
rem  Re-running it stops the test-mode server still holding that port first, so
rem  double-clicking twice restarts it instead of doing nothing.
rem
rem  Applies to HUMAN players in SOLO rooms only; bots are untouched and a
rem  multiplayer room is never affected. See docs/DEV-MODE.md.
rem ===========================================================================
rem %~dp0 ends with a backslash; strip it so joined paths get one separator.
set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"

rem ---- argument 1 = the fund amount; every argument AFTER it is passed on ----
set "AMOUNT=%~1"
if not defined AMOUNT set "AMOUNT=9999"
rem accept digits only: a junk argument must fall back, not reach the server
echo %AMOUNT%|findstr /r "^[0-9][0-9]*$" >nul || set "AMOUNT="
if not defined AMOUNT set "AMOUNT=9999"
set "SP_DEV_FUNDS=%AMOUNT%"

rem Collect the remaining arguments. This must be a shift loop: the first
rem argument here is the AMOUNT, so a fixed "%2 %3 %4 %5" would silently drop
rem the value of a "--port 3000" pair and the server would fall back to 3000.
set "REST="
shift
:args
if "%~1"=="" goto :argsdone
set "REST=%REST% %1"
shift
goto :args
:argsdone

rem Default port 3001 (launch.mjs reads PORT from the environment; an explicit
rem --port in REST still wins). Set to 3000 to deliberately replace a running
rem normal server instead of running beside it.
if not defined PORT set "PORT=3001"

echo [TEST MODE] unlimited funds ON: topping up to %AMOUNT% each prep (solo rooms, human players)
echo [TEST MODE] this server listens on http://localhost:%PORT%

rem Stop a test-mode server still holding that port, so a second double-click
rem restarts instead of hitting "already running" (which exits 0 and closes).
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo [TEST MODE] stopping the previous server on port %PORT% ^(pid %%P^)
  taskkill /f /pid %%P >nul 2>&1
)
rem give the OS a moment to release the port
ping -n 2 127.0.0.1 >nul

rem Game root = the folder holding scripts\launch.mjs: this folder in a source
rem checkout, the "app" folder beside us in the release package.
set "APPDIR="
if exist "%HERE%\scripts\launch.mjs" set "APPDIR=%HERE%"
if not defined APPDIR if exist "%HERE%\app\scripts\launch.mjs" set "APPDIR=%HERE%\app"
if not defined APPDIR (
  echo [TEST MODE] scripts\launch.mjs not found - put this file in the game folder
  echo             or in the root of the release package.
  pause
  exit /b 1
)

rem Node: the bundled one in the release package, the system one otherwise.
set "NODE="
if exist "%HERE%\node\node.exe" set "NODE=%HERE%\node\node.exe"
if not defined NODE if exist "%HERE%\..\node\node.exe" set "NODE=%HERE%\..\node\node.exe"
if not defined NODE set "NODE=node"

rem --test-mode 1 asks for 测试房间 on this process (upstream v0.3.1's SP_TEST_MODE gate, DESIGN §34.8).
rem The listener keeps the normal all-interfaces bind, so friends can still reach a test room over the LAN.
rem The gate judges the BOUND address, so a VPN adapter or a public IPv6 on this machine makes `1` refuse; that is
rem why server/lobby.js also accepts a test-room create whose request comes from THIS machine (docs/DEV-MODE.md).
rem So 测试模式 works locally even when this switch is refused -- `force` is only needed when a REMOTE peer should
rem be able to create one.
"%NODE%" "%APPDIR%\scripts\launch.mjs" --no-setup --test-mode 1%REST%
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%