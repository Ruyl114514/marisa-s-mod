@echo off
setlocal
cd /d "%~dp0.."
if not defined SP_SCRIPT_PROBE_MS set "SP_SCRIPT_PROBE_MS=20000"
rem 源码仓库里才需要装 MOD 插件本体（完整包里 plugins\marisa 已就位，脚本自己判断）
if exist "scripts\install-marisa.mjs" node scripts/install-marisa.mjs
if errorlevel 1 goto :fail
node scripts/launch.mjs --no-setup --port 3000 --scripts sandbox %*
set "SP_LAUNCH_RESULT=%errorlevel%"
if not "%SP_LAUNCH_RESULT%"=="0" pause
exit /b %SP_LAUNCH_RESULT%

:fail
pause
exit /b 1
