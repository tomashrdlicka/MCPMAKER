# MCPMAKER

**Watch. Learn. Replace the Browser.**

MCPMAKER observes you using web apps, captures the API calls happening underneath, and auto-generates MCP servers that replace the browser entirely.

Instead of teaching AI agents to click buttons and fill forms, MCPMAKER watches you do it once, extracts the underlying API patterns, and generates a clean machine-to-machine interface. No browser needed. No screenshots. No DOM selectors.

## How it works

1. **Record** - Chrome extension captures your clicks AND the network requests they trigger
2. **Analyze** - Claude identifies the real API calls (filtering noise), detects multi-step chains, and parameterizes the workflow
3. **Generate** - Produces a working MCP server with typed tools matching what you just did
4. **Use** - Any AI agent calls the MCP tools directly. 10-100x faster than browser automation.

## Why

> "Maybe you don't download, configure and take dependency on a giant monolithic library, maybe you point your agent at it and rip out the exact part you need."

Every web app is already making structured API calls under its UI. MCPMAKER surfaces them. Every workflow it observes makes the browser automation layer less necessary.

## Status

Design phase. See [docs/design.md](docs/design.md) for the full design document.

## Architecture

```
Chrome Extension          Local Engine            MCP Server
(observe)                 (analyze)               (generate)

DOM events ----+
               +--> Tap Engine --> Claude API --> MCP Server
Network    ----+    (localhost)    (analysis)     (deployed)
requests
```

## Stack

- **Extension**: Chrome Manifest V3 (TypeScript)
- **Engine**: Node/Bun on localhost
- **Analysis**: Claude API (Anthropic)
- **Output**: MCP servers (TypeScript, stdio transport)
- **Storage**: SQLite

## License

MIT
