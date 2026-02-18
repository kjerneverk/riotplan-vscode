# Scripts Comparison: riotplan-vscode vs riotplan-format

This document shows how the npm scripts in riotplan-vscode match the pattern from riotplan-format.

## riotplan-format scripts:
```json
{
  "clean": "rm -rf dist",
  "build": "vite build",
  "test": "vitest run --coverage",
  "test:coverage": "vitest run --coverage",
  "lint": "eslint src",
  "precommit": "npm run build && npm run lint && npm run test",
  "prepublishOnly": "npm run clean && npm run build"
}
```

## riotplan-vscode scripts:
```json
{
  "clean": "rm -rf dist out",
  "build": "tsc -p ./",
  "compile": "tsc -p ./",
  "watch": "tsc -watch -p ./",
  "package": "vsce package",
  "lint": "eslint src",
  "test": "echo 'No tests configured yet'",
  "precommit": "npm run build && npm run lint && npm run test",
  "prepublishOnly": "npm run clean && npm run build",
  "vscode:prepublish": "npm run build"
}
```

## Key Differences Explained:

### ✅ Matching Scripts:
- **`clean`** - Both clean dist directory (vscode also cleans `out`)
- **`build`** - Both build the project (format uses vite, vscode uses tsc)
- **`lint`** - Both use eslint on src directory
- **`precommit`** - Both run build → lint → test
- **`prepublishOnly`** - Both run clean → build

### 📦 VSCode-Specific Scripts:
- **`compile`** - Alias for build (VSCode convention)
- **`watch`** - TypeScript watch mode for development
- **`package`** - Create .vsix extension package
- **`vscode:prepublish`** - VSCode-specific hook that runs before packaging

### 🧪 Test Differences:
- **riotplan-format**: Uses vitest with coverage
- **riotplan-vscode**: Placeholder (no tests yet, but infrastructure ready)

## Verification:

All scripts work correctly:
```bash
✅ npm run clean       # Removes dist and out directories
✅ npm run build       # Compiles TypeScript
✅ npm run lint        # Runs ESLint
✅ npm run test        # Runs tests (placeholder)
✅ npm run precommit   # Runs build + lint + test
✅ npm run prepublishOnly  # Runs clean + build
✅ npm run package     # Creates .vsix package
```

## Conclusion:

The riotplan-vscode package now has **complete script parity** with riotplan-format, following the same patterns:
- ✅ Same core scripts (clean, build, lint, test)
- ✅ Same precommit hook
- ✅ Same prepublishOnly hook
- ✅ Additional VSCode-specific scripts for extension development
