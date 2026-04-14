#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const platform = process.platform;
const arch = process.arch;
const pkgName = `@wxj-1019/latte-code-${platform}-${arch}`;

const binaryName = platform === 'win32' ? 'latte' : 'latte';

let binaryPath;
try {
  binaryPath = require.resolve(path.join(pkgName, binaryName));
} catch {
  console.error(`
[x] Unsupported platform: ${platform}-${arch}

Latte is not available for your system. Supported platforms:
  - macOS Intel (x64)
  - macOS Apple Silicon (arm64)
  - Linux (x64)
  - Linux (arm64)
  - Windows (x64)

You can still build from source:
  https://github.com/wxj-1019/latte-code#构建
`);
  process.exit(1);
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  windowsHide: false,
});

process.exit(result.status ?? 0);
