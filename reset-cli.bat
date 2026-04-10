@echo off
chcp 65001 >nul
:: ============================================================
:: free-code CLI 重置工具 (Windows CMD 版本)
:: ============================================================
:: 用法:
::   reset-cli.bat         - 交互式重置
::   reset-cli.bat /F      - 强制重置，跳过确认
::   reset-cli.bat /B      - 重置前备份配置
::   reset-cli.bat /K      - 保留环境变量
:: ============================================================

setlocal EnableDelayedExpansion

:: 解析参数
set "FORCE="
set "BACKUP="
set "KEEPENV="

:parse_args
if "%~1"=="" goto :main
if /I "%~1"=="/F" set "FORCE=1"
if /I "%~1"=="/FORCE" set "FORCE=1"
if /I "%~1"=="/B" set "BACKUP=1"
if /I "%~1"=="/BACKUP" set "BACKUP=1"
if /I "%~1"=="/K" set "KEEPENV=1"
if /I "%~1"=="/KEEPENV" set "KEEPENV=1"
shift
goto :parse_args

:main
title free-code CLI 重置工具
cls

echo.
echo  =============================================================
echo    free-code CLI 重置工具
echo  =============================================================
echo.

:: 获取配置路径
set "CONFIG_FILE=%USERPROFILE%\.claude.json"
set "LEGACY_CONFIG=%USERPROFILE%\.config.json"
set "CLAUDE_DIR=%USERPROFILE%\.claude"

:: 检查要删除的内容
set "HAS_SOMETHING="

echo  [检查] 发现以下配置:
echo.

if exist "%CONFIG_FILE%" (
    echo    [配置文件] %CONFIG_FILE%
    set "HAS_SOMETHING=1"
)

if exist "%LEGACY_CONFIG%" (
    echo    [旧版配置] %LEGACY_CONFIG%
    set "HAS_SOMETHING=1"
)

if exist "%CLAUDE_DIR%" (
    echo    [配置目录] %CLAUDE_DIR%
    set "HAS_SOMETHING=1"
)

:: 检查环境变量
echo.
echo  [检查] 环境变量:
set "ENV_FOUND="
for %%V in (LATTE_API_KEY LATTE_BASE_URL LATTE_MODEL ANTHROPIC_API_KEY ANTHROPIC_MODEL CLAUDE_CODE_USE_OPENAI CLAUDE_CONFIG_DIR) do (
    if not "!%%V!"=="" (
        echo    [环境变量] %%V=%%V
        set "ENV_FOUND=1"
    )
)

if not defined HAS_SOMETHING if not defined ENV_FOUND (
    echo.
    echo  [信息] 没有发现需要重置的配置！
    goto :end
)

echo.

:: 确认提示
if not defined FORCE (
    set /p "CONFIRM=确定要重置吗？这将清除所有配置 [y/N]: "
    if /I not "!CONFIRM!"=="y" if /I not "!CONFIRM!"=="yes" (
        echo.
        echo  [取消] 操作已取消
        goto :end
    )
)

:: 备份
if defined BACKUP (
    echo.
    echo  =============================================================
    echo    正在备份配置...
    echo  =============================================================
    echo.
    
    for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (
        for /f "tokens=1-2 delims=: " %%c in ('time /t') do (
            set "BACKUP_NAME=claude-backup-%%c%%d-%%a%%b-%%c%%d"
        )
    )
    set "BACKUP_DIR=%TEMP%\claude-backup-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%"
    set "BACKUP_DIR=%BACKUP_DIR: =0%"
    
    mkdir "%BACKUP_DIR%" 2>nul
    
    if exist "%CONFIG_FILE%" (
        copy "%CONFIG_FILE%" "%BACKUP_DIR%\" >nul
        if !ERRORLEVEL! equ 0 (
            echo    [OK] 已备份: %CONFIG_FILE%
        ) else (
            echo    [ERR] 备份失败: %CONFIG_FILE%
        )
    )
    
    if exist "%LEGACY_CONFIG%" (
        copy "%LEGACY_CONFIG%" "%BACKUP_DIR%\" >nul
        if !ERRORLEVEL! equ 0 (
            echo    [OK] 已备份: %LEGACY_CONFIG%
        ) else (
            echo    [ERR] 备份失败: %LEGACY_CONFIG%
        )
    )
    
    if exist "%CLAUDE_DIR%" (
        xcopy "%CLAUDE_DIR%" "%BACKUP_DIR%\.claude\" /E /I /H /Y >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            echo    [OK] 已备份: %CLAUDE_DIR%
        ) else (
            echo    [ERR] 备份失败: %CLAUDE_DIR%
        )
    )
    
    echo.
    echo  [信息] 备份位置: %BACKUP_DIR%
)

:: 执行删除
echo.
echo  =============================================================
echo    正在重置...
echo  =============================================================
echo.

set "SUCCESS=0"
set "FAILED=0"

:: 删除配置文件
if exist "%CONFIG_FILE%" (
    del "%CONFIG_FILE%" /F /Q >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo    [OK] 已删除: %CONFIG_FILE%
        set /a SUCCESS+=1
    ) else (
        echo    [ERR] 删除失败: %CONFIG_FILE%
        set /a FAILED+=1
    )
) else (
    echo    [SKIP] 不存在: %CONFIG_FILE%
)

if exist "%LEGACY_CONFIG%" (
    del "%LEGACY_CONFIG%" /F /Q >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo    [OK] 已删除: %LEGACY_CONFIG%
        set /a SUCCESS+=1
    ) else (
        echo    [ERR] 删除失败: %LEGACY_CONFIG%
        set /a FAILED+=1
    )
) else (
    echo    [SKIP] 不存在: %LEGACY_CONFIG%
)

:: 删除配置目录
if exist "%CLAUDE_DIR%" (
    rmdir "%CLAUDE_DIR%" /S /Q >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo    [OK] 已删除: %CLAUDE_DIR%
        set /a SUCCESS+=1
    ) else (
        echo    [ERR] 删除失败: %CLAUDE_DIR% (可能需要管理员权限)
        set /a FAILED+=1
    )
) else (
    echo    [SKIP] 不存在: %CLAUDE_DIR%
)

:: 清除环境变量
if not defined KEEPENV (
    echo.
    echo  [信息] 清除环境变量...
    for %%V in (LATTE_API_KEY LATTE_BASE_URL LATTE_MODEL ANTHROPIC_API_KEY ANTHROPIC_MODEL CLAUDE_CODE_USE_OPENAI) do (
        if not "!%%V!"=="" (
            set "%%V="
            echo    [OK] 已清除: %%V
            set /a SUCCESS+=1
        )
    )
)

:: 显示结果
echo.
echo  =============================================================
echo    重置完成
echo  =============================================================
echo.
echo    成功: %SUCCESS%
if %FAILED% gtr 0 echo    失败: %FAILED%
echo.
echo  [OK] CLI 已重置为初始状态
echo.
echo  下次启动时将需要:
echo    1. 重新登录或配置 API Key
echo    2. 重新确认项目信任
echo    3. 重新选择主题和设置

if defined BACKUP (
    echo.
    echo  [信息] 如需恢复配置，可以从以下位置复制备份:
    echo        %BACKUP_DIR%
)

:end
echo.
echo  按任意键退出...
pause >nul
endlocal
