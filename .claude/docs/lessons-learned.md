# Lessons Learned

Errors encountered, debugging insights, and process learnings.

## 2026-02-14

### 1. Parallel Bash Calls Cancel on Sibling Failure

**What went wrong**: Ran `npx tsc --noEmit` for engine and extension in parallel. Engine had pre-existing test file errors (exit code 2), which cancelled the extension type-check with `Sibling tool call errored`.

**Why it happened**: When parallel Bash tool calls are made and one fails (non-zero exit), sibling calls get cancelled automatically.

**How it was fixed**: Re-ran the commands separately. Filtered engine output with `grep -v '__tests__'` to isolate source-only errors.

**Prevention rule**: When running parallel commands where any might fail (e.g., type-checking codebases with known issues), run them sequentially or expect sibling cancellation. Filter known failures upfront.
