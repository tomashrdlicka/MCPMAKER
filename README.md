# MCPMAKER

**Record once. Press Play.**

Do a tedious web workflow once while MCPMAKER watches. Next time, press Play and watch the agent do it for you.

## How it works

1. **Record** - Install the Chrome extension. Click Record. Do your workflow. Click Stop.
2. **Learn** - MCPMAKER captures every click AND the API calls underneath. It learns the workflow, not just the clicks.
3. **Play** - Next time, open the extension, press Play. Watch the agent navigate the site for you, step by step. Pause or stop anytime.

## What makes this different

Every browser automation tool (Stagehand, Browser-Use, Selenium) figures out what to do **at runtime** via LLM calls. Every run is a guess.

MCPMAKER already knows the exact steps because it watched you do it. The agent doesn't guess - it executes a learned path. And because it captured the API calls underneath, it can **validate** each step actually worked, and adapt when the UI changes.

| | Runtime AI (Stagehand) | Macros | **MCPMAKER** |
|---|---|---|---|
| Learns how? | LLM guesses at runtime | Hardcoded selectors | Watches you do it |
| Handles UI changes? | Re-guesses (unreliable) | Breaks | Knows the intent + API, adapts |
| Cost per run | $$$ (LLM per click) | Free | Minimal |
| User trust | Black box | Predictable but fragile | Watch it work, intervene anytime |
| Setup | Developer writes code | Developer writes scripts | Record and Play |

## Status

Design phase. See [docs/design.md](docs/design.md) for the full design document.

## Architecture

```
  RECORD                    LEARN                     PLAY
+------------+        +---------------+        +----------------+
| Chrome     | -----> | Local Engine  | -----> | Agent drives   |
| Extension  |        | + Claude API  |        | your browser   |
|            |        |               |        |                |
| Captures:  |        | Produces:     |        | User watches:  |
| - Clicks   |        | - Workflow    |        | - Each click   |
| - Typing   |        |   definition  |        | - Each step    |
| - API calls|        | - Parameters  |        | - The result   |
| - Context  |        | - Validation  |        |                |
+------------+        +---------------+        +----------------+
```

## Stack

- **Extension**: Chrome Manifest V3 (TypeScript)
- **Engine**: Bun on localhost
- **Analysis**: Claude API (Anthropic)
- **Playback**: Chrome DevTools Protocol (CDP)
- **Storage**: SQLite

## License

MIT
