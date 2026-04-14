#!/usr/bin/env bun
/**
 * NPM platform-specific package publisher
 *
 * Usage:
 *   bun run ./scripts/publish-npm.ts --binary-dir ./dist/binaries
 *   bun run ./scripts/publish-npm.ts --binary-dir ./dist/binaries --dry-run
 */

import { existsSync, copyFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  name: string
  version: string
  repository: { url: string }
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')

let binaryDir = ''
const binaryDirIndex = args.indexOf('--binary-dir')
if (binaryDirIndex !== -1 && args[binaryDirIndex + 1]) {
  binaryDir = resolve(args[binaryDirIndex + 1]!)
}

const repoUrl = pkg.repository?.url ?? 'git+https://github.com/wxj-1019/latte-code.git'
const version = pkg.version

const platforms = [
  { name: '@wxj-1019/latte-code-darwin-x64', os: 'darwin', cpu: 'x64', binary: 'latte', dirName: 'latte-code-darwin-x64' },
  { name: '@wxj-1019/latte-code-darwin-arm64', os: 'darwin', cpu: 'arm64', binary: 'latte', dirName: 'latte-code-darwin-arm64' },
  { name: '@wxj-1019/latte-code-linux-x64', os: 'linux', cpu: 'x64', binary: 'latte', dirName: 'latte-code-linux-x64' },
  { name: '@wxj-1019/latte-code-linux-arm64', os: 'linux', cpu: 'arm64', binary: 'latte', dirName: 'latte-code-linux-arm64' },
  { name: '@wxj-1019/latte-code-win32-x64', os: 'win32', cpu: 'x64', binary: 'latte.exe', dirName: 'latte-code-win32-x64' },
] as const

function run(cmd: string[], cwd: string): { success: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: cmd[0] === 'npm' ? ['npm', ...cmd.slice(1)] : cmd,
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NPM_CONFIG_REGISTRY: process.env.NPM_CONFIG_REGISTRY || 'https://registry.npmjs.org/' },
  })
  return {
    success: proc.exitCode === 0,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  }
}

function publishPackage(pkgDir: string, pkgName: string): void {
  console.log(`\n[→] Publishing ${pkgName}...`)
  if (dryRun) {
    console.log(`    (dry-run) Would run: npm publish --access public in ${pkgDir}`)
    return
  }
  const result = run(['npm', 'publish', '--access', 'public'], pkgDir)
  if (!result.success) {
    console.error(`    [x] Failed to publish ${pkgName}`)
    console.error(`    ${result.stderr}`)
    process.exit(1)
  }
  console.log(`    [+] ${pkgName} published successfully`)
}

async function main() {
  if (!binaryDir) {
    console.error('Usage: bun run ./scripts/publish-npm.ts --binary-dir <path> [--dry-run]')
    process.exit(1)
  }

  if (!existsSync(binaryDir)) {
    console.error(`[x] Binary directory not found: ${binaryDir}`)
    process.exit(1)
  }

  console.log(`[*] Publishing @wxj-1019/latte-code v${version}`)
  console.log(`    Binary directory: ${binaryDir}`)
  if (dryRun) {
    console.log('    Mode: DRY RUN')
  }

  // Publish platform packages
  for (const platform of platforms) {
    const pkgDir = resolve(join('npm', platform.dirName))
    const sourceBinary = join(binaryDir, platform.binary === 'latte.exe' ? `${platform.dirName}.exe` : platform.dirName)

    if (!existsSync(sourceBinary)) {
      console.warn(`[!] Binary not found for ${platform.name}: ${sourceBinary}`)
      console.warn(`    Skipping ${platform.name}...`)
      continue
    }

    mkdirSync(pkgDir, { recursive: true })

    const targetBinary = join(pkgDir, platform.binary)
    copyFileSync(sourceBinary, targetBinary)

    const platformPkg = {
      name: platform.name,
      version,
      description: `Latte CLI binary for ${platform.os} (${platform.cpu})`,
      license: 'MIT',
      repository: { type: 'git', url: repoUrl },
      files: [platform.binary],
      bin: { [platform.dirName]: `./${platform.binary}` },
      engines: { node: '>=18' },
      os: [platform.os],
      cpu: [platform.cpu],
    }

    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(platformPkg, null, 2) + '\n')
    publishPackage(pkgDir, platform.name)
  }

  // Publish main package
  const mainPkgDir = resolve(join('npm', 'latte-code'))
  const mainPkg = {
    name: '@wxj-1019/latte-code',
    version,
    description: 'Latte - A buildable fork of Claude Code CLI with telemetry removed and experimental features unlocked.',
    license: 'MIT',
    repository: { type: 'git', url: repoUrl },
    homepage: 'https://github.com/wxj-1019/latte-code#readme',
    bugs: { url: 'https://github.com/wxj-1019/latte-code/issues' },
    bin: { latte: './bin/latte.js' },
    files: ['bin', 'README.md'],
    optionalDependencies: {
      '@wxj-1019/latte-code-darwin-x64': version,
      '@wxj-1019/latte-code-darwin-arm64': version,
      '@wxj-1019/latte-code-linux-x64': version,
      '@wxj-1019/latte-code-linux-arm64': version,
      '@wxj-1019/latte-code-win32-x64': version,
    },
    engines: { node: '>=18' },
    keywords: ['claude', 'claude-code', 'ai', 'cli', 'latte', 'coding-agent'],
  }

  writeFileSync(join(mainPkgDir, 'package.json'), JSON.stringify(mainPkg, null, 2) + '\n')
  publishPackage(mainPkgDir, '@wxj-1019/latte-code')

  console.log('\n[+] All packages published successfully!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
