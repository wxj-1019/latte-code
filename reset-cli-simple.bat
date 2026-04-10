@echo off
chcp 65001 >nul 2>&1
title free-code CLI Reset Tool
cls

echo.
echo ===========================================
echo   free-code CLI Reset Tool
echo ===========================================
echo.

set "CONFIG_FILE=%USERPROFILE%\.claude.json"
set "CLAUDE_DIR=%USERPROFILE%\.claude"
set "HAS_CONFIG="

echo Checking for configuration files...
echo.

if exist "%CONFIG_FILE%" (
    echo [Found] %CONFIG_FILE%
    set "HAS_CONFIG=1"
)

if exist "%CLAUDE_DIR%" (
    echo [Found] %CLAUDE_DIR%
    set "HAS_CONFIG=1"
)

if "%HAS_CONFIG%"=="" (
    echo.
    echo No configuration found. Nothing to reset.
    goto :end
)

echo.
echo WARNING: This will delete all CLI configuration!
echo.
set /p CONFIRM="Are you sure? [y/N]: "

if /I not "%CONFIRM%"=="y" (
    echo.
    echo Cancelled.
    goto :end
)

echo.
echo Deleting configuration...
echo.

if exist "%CONFIG_FILE%" (
    del "%CONFIG_FILE%" /F /Q >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to delete: %CONFIG_FILE%
    ) else (
        echo [OK] Deleted: %CONFIG_FILE%
    )
)

if exist "%CLAUDE_DIR%" (
    rmdir "%CLAUDE_DIR%" /S /Q >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Failed to delete: %CLAUDE_DIR%
    ) else (
        echo [OK] Deleted: %CLAUDE_DIR%
    )
)

echo.
echo ===========================================
echo   Reset Complete
echo ===========================================
echo.
echo CLI has been reset to initial state.
echo.
echo Next time you start, you will need to:
echo   1. Login or configure API Key
echo   2. Confirm project trust
echo   3. Select theme and settings
echo.

:end
echo Press any key to exit...
pause >nul
