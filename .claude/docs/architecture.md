# MCPMAKER Architecture

## Overview

MCPMAKER ("Record Once, Press Play") is a Chrome extension + local engine that watches users perform web workflows, learns the interaction patterns and underlying API calls, then replays them autonomously. The system has two execution modes: deterministic playback (selector-based) and intelligent playback (Claude vision + DOM).

## Package Structure

```
packages/
  engine/          # Local Node.js HTTP server (localhost:7433)
  extension/       # Chrome Manifest V3 extension
```

## Extension Architecture

### Content Script (`content-script.ts`)
- Captures DOM events (click, input, change, submit, navigate, keydown)
- Generates robust CSS selectors (ID > data-testid > aria-label > path)
- Captures page snapshots for intelligent playback: interactive elements (cap 100), forms, navigation context, headings
- Executes DOM actions during playback (`EXECUTE_DOM_ACTION`)
- Element location strategies: exact selector > fallback selectors > aria-label > text content

### Service Worker (`service-worker.ts`)
- State management for recording and playback
- Network interception via `chrome.webRequest` (filters tracking/static assets)
- DOM-network event correlation (2s time window)
- Engine communication (sessions, analysis, playback endpoints)
- Two playback controllers:
  - `PlaybackController` - deterministic, selector-based (original)
  - `IntelligentPlaybackController` - Claude vision + DOM snapshots (new)

### Popup (`popup.ts` + `popup.css`)
- Recording controls (start/stop)
- Workflow list per site
- Playback controls (play/pause/stop)
- Parameter input forms

## Engine Architecture

### Server (`server.ts`)
Pure Node.js HTTP server on `localhost:7433`. Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| POST | `/sessions` | Store recording session |
| GET | `/sessions` | List sessions |
| GET | `/sessions/:id` | Get session |
| POST | `/analyze` | Run analysis pipeline |
| GET | `/workflows` | List workflows |
| GET | `/workflows/:id` | Get workflow |
| DELETE | `/workflows/:id` | Delete workflow |
| POST | `/workflows/:id/play` | Trigger playback |
| POST | `/workflows/:id/deploy` | Deploy as MCP server |
| GET | `/workflows/:id/status` | Check status |
| POST | `/config/api-key` | Store Anthropic API key |
| GET | `/config/api-key` | Check if key configured |
| POST | `/playback/next-action` | Claude vision: get next action |
| POST | `/playback/intent` | Extract workflow intent |
| POST | `/playback/log` | Save playback log entry |
| GET | `/playback/insights/:workflowId` | Get past insights |

### Database (`database.ts`)
SQLite via `better-sqlite3` at `~/.mcpmaker/mcpmaker.db`.

Tables: `sessions`, `workflows`, `workflow_sessions`, `config`, `playback_logs`

### Analysis Pipeline (`analysis/`)
6-stage LLM pipeline using Claude:
1. **Noise Filtering** - classify network events as CORE/SUPPORTING/NOISE
2. **Correlation Validation** - verify DOM-network event relationships
3. **Parameterization** - identify variable vs fixed parts across recordings
4. **Step Chain Detection** - find data dependencies between sequential API calls
5. **Auth Pattern Detection** - identify cookie/bearer/API key patterns
6. **Workflow Definition** - generate final structured WorkflowDefinition

### LLM Client (`analysis/llm.ts`)
- Text and vision (multimodal) Claude calls
- JSON extraction from responses
- Retry logic with exponential backoff
- Header redaction for sensitive data
- Intelligent playback functions: `getNextPlaybackAction()`, `extractWorkflowIntent()`
- System prompt builds full context: mode, intent, step history, past insights, DOM snapshot, interactive elements

## Intelligent Playback (Vision + DOM)

### Flow
```
1. Capture screenshot (chrome.tabs.captureVisibleTab)
2. Capture DOM snapshot (CAPTURE_PAGE_SNAPSHOT content script message)
3. Auto-select mode: recovery (if error) > guided (if step exists) > generative
4. Build context with full action history + past insights
5. POST to engine /playback/next-action (Claude vision)
6. Execute returned action via content script
7. Record result, advance step if indicated
8. Loop (max 100 actions, max 3 retries per step)
```

### Learning Over Time
- After each playback run, a `PlaybackLogEntry` is saved with all actions + outcome
- Claude generates insights distilling what worked/failed
- On subsequent runs, past insights are injected into the prompt
- Fewer tokens needed over time as Claude starts with prior knowledge

### Fallback
If engine is unavailable or API key not configured, falls back to deterministic `PlaybackController`.

## Data Flow

```
Recording:
  User actions -> Content Script -> Service Worker -> Engine /sessions -> SQLite

Analysis:
  Engine /analyze -> Load sessions -> 6-stage LLM pipeline -> WorkflowDefinition -> SQLite

Playback (Intelligent):
  Extension captures screenshot+DOM -> Engine /playback/next-action -> Claude vision
  -> Action returned -> Content script executes -> Result recorded -> Loop
  -> After completion: /playback/log saves insights for next run

Playback (Deterministic):
  WorkflowDefinition steps -> Content script EXECUTE_DOM_ACTION per step
```
