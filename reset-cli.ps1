#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
    重置 free-code CLI 配置和数据
.DESCRIPTION
    清除所有配置文件、缓存数据、认证信息和环境变量，使 CLI 恢复到初始状态
.PARAMETER Force
    跳过确认提示，直接执行重置
.PARAMETER KeepEnv
    保留环境变量设置（不清除 LATTE_* 等环境变量）
.PARAMETER Backup
    在删除前备份配置文件
.EXAMPLE
    .\reset-cli.ps1
    交互式重置，会询问确认
.EXAMPLE
    .\reset-cli.ps1 -Force
    强制重置，跳过确认
.EXAMPLE
    .\reset-cli.ps1 -Backup
    重置前备份配置文件
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$KeepEnv,
    [switch]$Backup
)

# 设置控制台编码
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.BackgroundColor = 'Black'

# 颜色定义
$colors = @{
    Success = 'Green'
    Warning = 'Yellow'
    Error = 'Red'
    Info = 'Cyan'
    Title = 'Magenta'
}

function Write-ColorLine {
    param(
        [string]$Message,
        [string]$Color = 'White',
        [switch]$NoNewline
    )
    $params = @{
        Object = $Message
        ForegroundColor = $Color
        NoNewline = $NoNewline
    }
    Write-Host @params
}

function Write-Header {
    param([string]$Title)
    Write-Host ''
    Write-Host ('=' * 60) -ForegroundColor $colors.Title
    Write-Host "  $Title" -ForegroundColor $colors.Title
    Write-Host ('=' * 60) -ForegroundColor $colors.Title
    Write-Host ''
}

function Write-Status {
    param(
        [string]$Status,
        [string]$Message,
        [switch]$Skip
    )
    if ($Skip) {
        Write-Host "  [SKIP] " -ForegroundColor Gray -NoNewline
    } elseif ($Status -eq 'OK') {
        Write-Host "  [OK]   " -ForegroundColor $colors.Success -NoNewline
    } elseif ($Status -eq 'WARN') {
        Write-Host "  [WARN] " -ForegroundColor $colors.Warning -NoNewline
    } elseif ($Status -eq 'ERR') {
        Write-Host "  [ERR]  " -ForegroundColor $colors.Error -NoNewline
    }
    Write-Host $Message
}

# 获取配置路径
function Get-ConfigPaths {
    $paths = @{}
    
    # 主目录
    $homeDir = $env:USERPROFILE
    if (-not $homeDir) { $homeDir = $env:HOME }
    
    # 配置文件
    $configDir = $env:CLAUDE_CONFIG_DIR
    if ($configDir) {
        $paths.ConfigFile = Join-Path $configDir ".claude.json"
    } else {
        $paths.ConfigFile = Join-Path $homeDir ".claude.json"
    }
    
    # 旧版配置文件
    $paths.LegacyConfigFile = Join-Path $homeDir ".config.json"
    
    # 配置目录
    $paths.ClaudeDir = Join-Path $homeDir ".claude"
    
    # 缓存目录
    $cacheDir = $env:LOCALAPPDATA
    if (-not $cacheDir) { $cacheDir = Join-Path $homeDir ".cache" }
    $paths.CacheDir = Join-Path $cacheDir "claude-code"
    
    return $paths
}

# 主程序
Clear-Host
Write-Header "free-code CLI 重置工具"

$paths = Get-ConfigPaths

# 显示将要删除的内容
Write-ColorLine "以下文件/目录将被删除:" $colors.Warning
Write-ColorLine ""

$itemsToDelete = @()

# 检查配置文件
if (Test-Path $paths.ConfigFile) {
    Write-Host "  [配置文件] " -NoNewline
    Write-Host $paths.ConfigFile -ForegroundColor Gray
    $itemsToDelete += $paths.ConfigFile
}

if (Test-Path $paths.LegacyConfigFile) {
    Write-Host "  [旧配置]   " -NoNewline
    Write-Host $paths.LegacyConfigFile -ForegroundColor Gray
    $itemsToDelete += $paths.LegacyConfigFile
}

if (Test-Path $paths.ClaudeDir) {
    Write-Host "  [配置目录] " -NoNewline
    Write-Host $paths.ClaudeDir -ForegroundColor Gray
    $itemsToDelete += $paths.ClaudeDir
}

# 检查环境变量
$envVars = @('LATTE_API_KEY', 'LATTE_BASE_URL', 'LATTE_MODEL', 
             'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 
             'CLAUDE_CODE_USE_OPENAI', 'CLAUDE_CONFIG_DIR')
$activeEnvVars = @()
foreach ($var in $envVars) {
    if ($env:$var) {
        $activeEnvVars += $var
    }
}

if ($activeEnvVars.Count -gt 0 -and -not $KeepEnv) {
    Write-Host ""
    Write-ColorLine "以下环境变量将被清除（当前会话）:" $colors.Warning
    foreach ($var in $activeEnvVars) {
        Write-Host "  [环境变量] " -NoNewline
        Write-Host "$var=$($env:$var)" -ForegroundColor Gray
    }
}

if ($itemsToDelete.Count -eq 0 -and $activeEnvVars.Count -eq 0) {
    Write-ColorLine "没有发现需要重置的配置！" $colors.Success
    exit 0
}

# 确认提示
Write-Host ""
if (-not $Force) {
    $confirm = Read-Host "确定要继续吗？这将清除所有 CLI 配置和数据 [y/N]"
    if ($confirm -notin @('y', 'Y', 'yes', 'YES')) {
        Write-ColorLine "操作已取消" $colors.Warning
        exit 0
    }
}

# 备份
if ($Backup) {
    $backupDir = Join-Path $env:TEMP "claude-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    
    Write-Header "备份配置"
    
    foreach ($item in $itemsToDelete) {
        if (Test-Path $item) {
            $dest = Join-Path $backupDir (Split-Path $item -Leaf)
            try {
                if ((Get-Item $item).PSIsContainer) {
                    Copy-Item $item $dest -Recurse -Force
                } else {
                    Copy-Item $item $dest -Force
                }
                Write-Status 'OK' "已备份: $item -> $dest"
            } catch {
                Write-Status 'ERR' "备份失败: $_"
            }
        }
    }
    
    Write-ColorLine "" $colors.Info
    Write-ColorLine "备份位置: $backupDir" $colors.Info
}

# 执行重置
Write-Header "执行重置"

$successCount = 0
$failCount = 0
$skipCount = 0

# 删除配置文件
foreach ($path in @($paths.ConfigFile, $paths.LegacyConfigFile)) {
    if (Test-Path $path) {
        try {
            Remove-Item $path -Force
            Write-Status 'OK' "已删除: $path"
            $successCount++
        } catch {
            Write-Status 'ERR' "删除失败: $path - $_"
            $failCount++
        }
    } else {
        Write-Status 'SKIP' "不存在: $path" -Skip
        $skipCount++
    }
}

# 删除配置目录
if (Test-Path $paths.ClaudeDir) {
    try {
        Remove-Item $paths.ClaudeDir -Recurse -Force
        Write-Status 'OK' "已删除: $paths.ClaudeDir"
        $successCount++
    } catch {
        Write-Status 'ERR' "删除失败: $paths.ClaudeDir - $_"
        $failCount++
    }
} else {
    Write-Status 'SKIP' "不存在: $paths.ClaudeDir" -Skip
    $skipCount++
}

# 清除环境变量
if (-not $KeepEnv) {
    Write-Host ""
    Write-ColorLine "清除环境变量:" $colors.Info
    foreach ($var in $activeEnvVars) {
        try {
            Remove-Item "Env:\$var" -ErrorAction Stop
            Write-Status 'OK' "已清除: $var"
            $successCount++
        } catch {
            Write-Status 'ERR' "清除失败: $var - $_"
            $failCount++
        }
    }
}

# 显示结果
Write-Header "重置完成"

Write-ColorLine "统计:" $colors.Title
Write-Status 'OK' "成功: $successCount"
if ($failCount -gt 0) {
    Write-Status 'ERR' "失败: $failCount"
}
if ($skipCount -gt 0) {
    Write-Status 'SKIP' "跳过: $skipCount" -Skip
}

Write-Host ""
Write-ColorLine "✓ CLI 已重置为初始状态" $colors.Success
Write-Host ""
Write-ColorLine "下次启动时将需要:" $colors.Info
Write-Host "  1. 重新登录或配置 API Key"
Write-Host "  2. 重新确认项目信任"
Write-Host "  3. 重新选择主题和设置"
Write-Host ""

if ($Backup) {
    Write-ColorLine "如需恢复配置，可以从以下位置复制备份:" $colors.Warning
    Write-ColorLine "  $backupDir" $colors.Info
    Write-Host ""
}

Write-ColorLine "按任意键退出..." $colors.Info
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
