@echo off
rem ===========================================================================
rem  魔理沙 MOD 一键更新（双击运行）
rem
rem  做什么：备份要覆盖的游戏文件 → 覆盖它们 → 校验 → 完成
rem  回退：   Upgrade-Backup-<时间>/ 里的文件就是原来的，复制回去即可
rem  详细说明见「安装前请先读我.txt」
rem
rem  这个脚本既服务「完整包」，也服务以后的「增量更新包」：
rem    · 完整包：根目录的一键更新.bat + 安装前请先读我.txt 单独放在包根，
rem      「游戏文件」「MOD 插件」「MOD 美术」目录都不存在，脚本会自动跳过；
rem    · 增量更新包：带上「游戏文件 / MOD 插件 / MOD 美术」三个目录，
rem      这里就是完整的备份-覆盖-安装-校验流程。
rem ===========================================================================
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title 魔理沙 MOD 一键更新

rem  游戏目录：更新包放在游戏目录里（或与它同级）时向上/就地找
set "GAME=%CD%\.."
if not exist "%GAME%\server\index.js" set "GAME=%CD%"
if not exist "%GAME%\server\index.js" (
  echo [错误] 找不到游戏目录（应含 server\index.js）。
  echo        请把本文件夹放到游戏目录里，或与游戏目录同级。
  echo.
  pause
  exit /b 1
)

set "STAMP=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=!STAMP: =0!"
set "BACKUP=%GAME%\Upgrade-Backup-!STAMP!"

echo.
echo === 魔理沙 MOD 更新 ===
echo   游戏目录：%GAME%
echo   备份目录：%BACKUP%
echo.

if not exist "游戏文件" (
  echo [1/5] 跳过：本文件夹没有「游戏文件」目录 ^(完整包里游戏本体已就位^)。
  goto :mod
)

echo [1/5] 备份将要覆盖的文件 ...
if not exist "%BACKUP%" mkdir "%BACKUP%"
powershell -NoProfile -Command ^
  "$src='游戏文件'; $dst='!BACKUP!'; Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object { $rel = $_.FullName.Substring((Resolve-Path $src).Path.Length + 1); $to = Join-Path $dst $rel; New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; $from = Join-Path '%GAME%' $rel; if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination $to -Force } }"
if errorlevel 1 goto :fail

echo [2/5] 覆盖游戏文件 ...
powershell -NoProfile -Command ^
  "$src=(Resolve-Path '游戏文件').Path; $dst='%GAME%'; Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object { $rel = $_.FullName.Substring($src.Length + 1); $to = Join-Path $dst $rel; New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $to -Force }"
if errorlevel 1 goto :fail
goto :mod

:mod
echo [3/5] 安装 MOD 插件 ...
if exist "MOD 插件\marisa" (
  powershell -NoProfile -Command ^
    "$src=(Resolve-Path 'MOD 插件\marisa').Path; $to=Join-Path '%GAME%' 'plugins\marisa'; New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; if (Test-Path -LiteralPath $to) { Remove-Item -LiteralPath $to -Recurse -Force }; Copy-Item -LiteralPath $src -Destination $to -Recurse -Force"
  if errorlevel 1 goto :fail
)
if exist "MOD 插件\config.json" (
  if not exist "%GAME%\plugins" mkdir "%GAME%\plugins"
  copy /y "MOD 插件\config.json" "%GAME%\plugins\config.json" >nul
)
if not exist "MOD 插件" (
  if exist "%GAME%\plugins\marisa" (
    echo     完整包已带 MOD 插件 ^(plugins\marisa^)，无需安装。
  ) else (
    echo     [警告] 游戏目录里没有 MOD 插件。请确认用的是带 MOD 的完整包。
  )
)

echo [4/5] 安装 MOD 美术 ...
if exist "MOD 美术" (
  powershell -NoProfile -Command ^
    "$src=(Resolve-Path 'MOD 美术').Path; $dst=Join-Path '%GAME%' 'public'; Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object { $rel = $_.FullName.Substring($src.Length + 1); $to = Join-Path $dst $rel; New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null; Copy-Item -LiteralPath $_.FullName -Destination $to -Force }"
  if errorlevel 1 goto :fail
) else (
  echo     ^(本包不含 MOD 美术目录；完整包里 MOD 美术已并入 public\assets^)
)

echo [5/5] 校验 ...
if not exist "校验.md5" (
  echo     ^(本包不含校验.md5；用 node tools\doctor.mjs 可以核对 MANIFEST^)
  goto :done
)
rem  路径分隔符用 /（md5sum 风格）；校验的是「覆盖后」的游戏目录，不是更新包自己。
powershell -NoProfile -Command ^
  "$bad=0; Get-Content -LiteralPath '校验.md5' | Where-Object { $_ -and $_[0] -ne '#' } | ForEach-Object { $i=$_.IndexOf('*'); $hash=$_.Substring(0,$i).Trim(); $rel=$_.Substring($i+1).Replace('/','\'); $p=Join-Path '%GAME%' $rel; if (-not (Test-Path -LiteralPath $p)) { Write-Host ('    缺失: ' + $rel); $bad++ } else { $h=(Get-FileHash -LiteralPath $p -Algorithm MD5).Hash.ToLower(); if ($h -ne $hash) { Write-Host ('    不一致: ' + $rel); $bad++ } } }; if ($bad -gt 0) { Write-Host ('    校验发现问题: ' + $bad + ' 个文件'); exit 1 } else { Write-Host '    全部一致' }"
if errorlevel 1 goto :fail

:done
echo.
echo === 完成 ===
if exist "%BACKUP%\*" echo   原来的文件已备份到：%BACKUP%
echo   现在可以双击 scripts\start-windows.bat 开始游戏。
echo.
pause
exit /b 0

:fail
echo.
echo [失败] 更新中断。已覆盖的文件可以从这里恢复：
echo   %BACKUP%
echo.
pause
exit /b 1
