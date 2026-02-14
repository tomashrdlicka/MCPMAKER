# Lessons Learned

Errors encountered, debugging insights, and process learnings.

## 2026-02-14

### 1. Parallel Bash Calls Cancel on Sibling Failure

**What went wrong**: Ran `npx tsc --noEmit` for engine and extension in parallel. Engine had pre-existing test file errors (exit code 2), which cancelled the extension type-check with `Sibling tool call errored`.

**Why it happened**: When parallel Bash tool calls are made and one fails (non-zero exit), sibling calls get cancelled automatically.

**How it was fixed**: Re-ran the commands separately. Filtered engine output with `grep -v '__tests__'` to isolate source-only errors.

**Prevention rule**: When running parallel commands where any might fail (e.g., type-checking codebases with known issues), run them sequentially or expect sibling cancellation. Filter known failures upfront.

### 2. TypeScript Build Requires npm install First

**What went wrong**: Ran `tsc --noEmit` to verify engine changes but `tsc` was not found in PATH.

**Why it happened**: The container had Node.js but not the project's devDependencies installed. TypeScript is a devDependency, not a global install.

**How it was fixed**: Ran `npm install` in the engine package first, then used `npx tsc` instead of bare `tsc`.

**Prevention rule**: Always run `npm install` (or check `node_modules` exists) before running any project-specific CLI tools like `tsc`, `eslint`, etc. Use `npx` to run package-local binaries.

### 3. Large Multi-File Scaffolds Benefit from Parallel Background Agents

**What went wrong**: Nothing broke, but scaffolding 40 files sequentially would have been slow.

**Why it happened**: The macOS app required 40 new Swift/Metal/JS files. Creating them one by one would consume excessive context.

**How it was fixed**: Launched 4 background agents in parallel for independent file groups (content-script, models, helpers, CDP core), while creating remaining files directly. All agents completed successfully.

**Prevention rule**: When creating many independent files, group them by dependency and launch parallel background agents. Verify each agent's output on completion. Reserve direct creation for files that depend on already-created content.
