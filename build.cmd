@echo off
setlocal enabledelayedexpansion
rem Build MdViewer.exe (single self-contained executable).
rem Requires only the .NET Framework compiler shipped with Windows.
rem (ASCII only on purpose: cmd.exe reads .cmd files in the OEM/ANSI codepage.)

cd /d "%~dp0"
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] C# compiler not found: %CSC%
  exit /b 1
)
if not exist "src\lib\WebView2Loader.dll" (
  echo [ERROR] Missing WebView2 files in src\lib - run fetch-webview2.ps1 first.
  exit /b 1
)

rem Embed everything under src\web plus the WebView2 DLLs as resources.
set RES=
for /r "src\web" %%F in (*) do (
  set "P=%%F"
  set "N=!P:%CD%\src\=!"
  set "N=!N:\=/!"
  set RES=!RES! /resource:"%%F","!N!"
)
for %%F in (src\lib\*.dll) do (
  set RES=!RES! /resource:"%%F","lib/%%~nxF"
)

if exist MdViewer.exe del MdViewer.exe
rem NOTE: the in-box csc.exe is the C# 5 compiler, so Program.cs stays C# 5 compatible.
set ICON=
if exist "src\app.ico" set ICON=/win32icon:src\app.ico

"%CSC%" /nologo /target:winexe /platform:x64 /optimize+ %ICON% ^
  /out:MdViewer.exe ^
  /reference:src\lib\Microsoft.Web.WebView2.Core.dll ^
  /reference:src\lib\Microsoft.Web.WebView2.WinForms.dll ^
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll ^
  /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ^
  !RES! ^
  src\Program.cs

if errorlevel 1 (
  echo.
  echo [FAILED] compilation error
  exit /b 1
)

for %%A in (MdViewer.exe) do echo [OK] MdViewer.exe  %%~zA bytes
endlocal
