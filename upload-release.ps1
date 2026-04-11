#!/usr/bin/env pwsh
# Upload release asset to GitHub
# Usage: .\upload-release.ps1 -Token "your_github_token"

param(
    [Parameter(Mandatory=$true)]
    [string]$Token,
    
    [string]$Repo = "wxj-1019/latte-code",
    [string]$Tag = "v2.1.87",
    [string]$File = "cli.exe",
    [string]$AssetName = "latte.exe"
)

$ErrorActionPreference = "Stop"

Write-Host "[*] Uploading $File to $Repo release $Tag..." -ForegroundColor Cyan

# Get upload URL from existing release
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers @{
        "Authorization" = "Bearer $Token"
        "Accept" = "application/vnd.github+json"
    }
    $uploadUrl = $release.upload_url -replace "{\\?name,label}", "?name=$AssetName"
    Write-Host "[+] Found release: $($release.name)" -ForegroundColor Green
} catch {
    Write-Host "[!] Release not found or error: $_" -ForegroundColor Red
    exit 1
}

# Upload the file
try {
    $fileBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))
    $result = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers @{
        "Authorization" = "Bearer $Token"
        "Accept" = "application/vnd.github+json"
        "Content-Type" = "application/octet-stream"
    } -Body $fileBytes
    
    Write-Host "[+] Upload successful!" -ForegroundColor Green
    Write-Host "    URL: $($result.browser_download_url)" -ForegroundColor Cyan
} catch {
    Write-Host "[!] Upload failed: $_" -ForegroundColor Red
    exit 1
}
