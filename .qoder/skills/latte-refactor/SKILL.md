---
name: latte-refactor
description: Extracts code from large files in latte-code projects (Bun + TypeScript + Ink React + Commander.js). Handles import conventions, circular dependency resolution, React Compiler patterns, and Commander.js action handler extraction. Use when refactoring or splitting files larger than 1000 lines in latte-code.
---

# Latte-Code Refactoring

## Quick Start

When extracting code from a large file:

1. Identify extractable module boundaries
2. Check for circular dependency risks
3. Create new file with complete imports
4. Remove code from source file
5. Add import in source file
6. Verify: `bun x tsc --noEmit --pretty`
7. Ignore pre-existing encoding errors (TS1002/TS1005/TS1127)

## Project Conventions

### Import Paths
- Always use `.js` extension: `import { x } from './foo.js';`
- `src/` path alias: `import { y } from 'src/utils/config.js';`
- From `src/main/subcommands/` directory, use `../../` for root-level imports

### Circular Dependencies
- Use dynamic `import()` in action handlers
- Use lazy `require()` at module level for feature-gated modules
- `getTeammateUtils()` pattern: wrap `require()` in a getter function

### Feature Flags
- `feature()` from `bun:bundle` enables compile-time dead code elimination
- Combine with runtime GrowthBook for phased rollouts
- Conditional `require()` at module level: `const mod = feature('X') ? require('../x.js') : null;`

### React Compiler
- Components use `import { c as _c } from 'react/compiler-runtime';`
- Cache arrays: `const $ = _c(N);` where N is the cache slot count
- Preserve compiler-generated variable names when extracting components

## Extraction Patterns

### Pattern 1: Top-Level Functions/Constants
```typescript
// Create src/main/myModule.ts
import { dep } from './dep.js';
export const MY_CONST = 'value';
export function myFunc() { /* ... */ }

// In source: replace with import
import { MY_CONST, myFunc } from './main/myModule.js';
```

### Pattern 2: Commander.js Action Handler
```typescript
// Create src/main/actionHandler.ts
// Copy ALL module-level imports needed by the action body
// No closure variables from run() are needed - all defined inside
export async function runAction(
  prompt: string | undefined,
  options: Record<string, unknown>
): Promise<void> {
  // Original action body (re-indented to 2 spaces)
}

// In source: replace action body with call
.action(async (prompt, options) => {
  await runAction(prompt, options as Record<string, unknown>);
})
```

### Pattern 3: Subcommand Registration
```typescript
// Create src/main/subcommands/feature.ts
import type { CommanderCommand } from '@commander-js/extra-typings';
import { createSortedHelpConfig } from '../helpConfig.js';

export function registerFeatureSubcommands(program: CommanderCommand): void {
  program.command('feature')
    .configureHelp(createSortedHelpConfig())
    .action(async (opts) => {
      const { handler } = await import('../../handlers/feature.js');
      await handler(opts);
    });
}
```

### Pattern 4: React Component Extraction
```typescript
// Create src/screens/components/MyComponent.tsx
import { c as _c } from 'react/compiler-runtime';
// Preserve _c(N) cache pattern and all compiler-generated variables
export function MyComponent({ ... }: Props): React.ReactNode {
  const $ = _c(N);
  // Keep original body intact
}
```

### Pattern 5: Type Extraction
```typescript
// Create src/screens/MyTypes.ts
import type { Dep } from '../deps.js';
export type MyType = { ... };

// In source: re-export to maintain backward compatibility
export type { MyType } from './MyTypes.js';
```

## File Size Limits

- `Write` tool: max ~1000 lines per call
- `SearchReplace`: combined old+new text under ~600 lines
- For files >1000 lines, use Bash concatenation:
  ```powershell
  Get-Content header.txt | Set-Content final.ts
  Get-Content body.txt | Add-Content final.ts
  ```

## Verification

Run after each extraction:
```bash
bun x tsc --noEmit --pretty 2>&1 | Select-String 'error TS' | Where-Object { $_ -notmatch 'TS1005|TS1127|TS1002' }
```

Exclude pre-existing Chinese encoding errors (TS1002, TS1005, TS1127 in sessionStorage.ts and log.ts). Only new errors require fixing.
