#!/usr/bin/env bun
/**
 * Global installation script for Latte CLI
 * 
 * Usage:
 *   bun run install:global     # Install to system PATH
 *   bun run uninstall:global   # Remove from system PATH
 */

import { existsSync, chmodSync, copyFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { homedir, platform } from 'os'

const isWindows = platform() === 'win32'

function getInstallDir(): string {
  if (isWindows) {
    // Windows: use LocalAppData
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'latte', 'bin')
  } else {
    // Unix: use ~/.local/bin (XDG standard)
    return join(homedir(), '.local', 'bin')
  }
}

function getShellConfig(): string | null {
  const shell = process.env.SHELL || ''
  if (shell.includes('zsh')) {
    return join(homedir(), '.zshrc')
  } else if (shell.includes('bash')) {
    return join(homedir(), '.bashrc')
  } else if (shell.includes('fish')) {
    return join(homedir(), '.config', 'fish', 'config.fish')
  }
  return null
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function installWindows(): void {
  const installDir = getInstallDir()
  ensureDir(installDir)
  
  const sourceExe = resolve('./latte.exe')
  const targetExe = join(installDir, 'latte.exe')
  
  if (!existsSync(sourceExe)) {
    console.error('❌ cli.exe not found. Please run "bun run build" first.')
    process.exit(1)
  }
  
  // Copy executable
  copyFileSync(sourceExe, targetExe)
  console.log(`✅ Installed: ${targetExe}`)
  
  // Add to PATH via registry or PowerShell
  const { execSync } = require('child_process')
  try {
    // Check if already in PATH
    const currentPath = process.env.PATH || ''
    if (!currentPath.includes(installDir)) {
      // Add to user PATH using PowerShell
      execSync(
        `[Environment]::SetEnvironmentVariable('PATH', [Environment]::GetEnvironmentVariable('PATH', 'User') + ';${installDir}', 'User')`,
        { shell: 'powershell.exe' }
      )
      console.log(`✅ Added to PATH: ${installDir}`)
      console.log('⚠️  Please restart your terminal or run "refreshenv" to update PATH')
    } else {
      console.log(`ℹ️  Already in PATH: ${installDir}`)
    }
  } catch (e) {
    console.warn('⚠️  Could not automatically add to PATH. Please add manually:')
    console.warn(`   ${installDir}`)
  }
}

function installUnix(): void {
  const installDir = getInstallDir()
  ensureDir(installDir)
  
  // Find the built executable
  let sourceExe = resolve('./latte')
  if (!existsSync(sourceExe)) {
    sourceExe = resolve('./latte.exe')
  }
  
  if (!existsSync(sourceExe)) {
    console.error('❌ cli not found. Please run "bun run build" first.')
    process.exit(1)
  }
  
  const targetExe = join(installDir, 'latte')
  
  // Copy and make executable
  copyFileSync(sourceExe, targetExe)
  chmodSync(targetExe, 0o755)
  console.log(`✅ Installed: ${targetExe}`)
  
  // Check if in PATH
  const pathDirs = (process.env.PATH || '').split(':')
  if (!pathDirs.includes(installDir)) {
    const shellConfig = getShellConfig()
    if (shellConfig) {
      console.log(`⚠️  Please add the following to your ${shellConfig}:`)
      console.log(`   export PATH="${installDir}:$PATH"`)
    } else {
      console.log(`⚠️  Please add ${installDir} to your PATH`)
    }
  } else {
    console.log(`✅ Already in PATH`)
  }
}

function uninstall(): void {
  const installDir = getInstallDir()
  const targetName = isWindows ? 'latte.exe' : 'latte'
  const targetPath = join(installDir, targetName)
  
  if (existsSync(targetPath)) {
    const { unlinkSync } = require('fs')
    unlinkSync(targetPath)
    console.log(`✅ Removed: ${targetPath}`)
  } else {
    console.log(`ℹ️  Not installed: ${targetPath}`)
  }
  
  if (isWindows) {
    console.log('⚠️  Please manually remove from PATH if needed')
  }
}

// Main
const action = process.argv[2] || 'install'

if (action === 'install' || action === 'add') {
  console.log('🚀 Installing Latte CLI globally...\n')
  if (isWindows) {
    installWindows()
  } else {
    installUnix()
  }
  console.log('\n✨ Installation complete!')
  console.log('   Try running: latte')
} else if (action === 'uninstall' || action === 'remove') {
  console.log('🗑️  Uninstalling Latte CLI...\n')
  uninstall()
  console.log('\n✨ Uninstall complete!')
} else {
  console.log('Usage:')
  console.log('  bun run install:global     # Install globally')
  console.log('  bun run uninstall:global   # Remove global installation')
  process.exit(1)
}
