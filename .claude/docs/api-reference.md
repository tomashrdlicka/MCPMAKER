# MCPMAKER Engine API Reference

Base URL: `http://localhost:7433`

All responses are JSON. CORS enabled for all origins.

## Health

### `GET /health`
Returns engine status.

**Response:**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 123.45,
  "databasePath": "/Users/.../.mcpmaker/mcpmaker.db"
}
```

## Sessions

### `POST /sessions`
Store a recording session. Auto-creates workflow if none exists for the workflow name.

**Body:** `{ session: Session }`

**Response (201):** `{ id, workflowName, workflowId }`

### `GET /sessions`
List sessions. Optional `?workflowId=` filter.

**Response:** `{ sessions: Session[] }`

### `GET /sessions/:id`
Get a specific session.

**Response:** `{ session: Session }`

## Workflows

### `GET /workflows`
List all workflows.

**Response:** `{ workflows: Workflow[] }`

### `GET /workflows/:id`
Get a specific workflow with definition and session IDs.

**Response:** `{ workflow: Workflow }`

### `DELETE /workflows/:id`
Delete a workflow and its sessions.

**Response:** `{ deleted: true }`

### `POST /workflows/:id/play`
Initiate visual playback (sets up state, extension controls actual playback).

**Body:** `{ parameters?: Record<string, unknown> }`

**Response:** `{ workflowId, playbackState, message }`

### `POST /workflows/:id/deploy`
Generate and start an MCP server for the workflow.

**Response:** `{ serverPath, status, pid?, error? }`

### `GET /workflows/:id/status`
Check MCP server and playback status.

**Response:** `{ workflowId, mcpServer: { status, path, pid, error }, playback }`

## Analysis

### `POST /analyze`
Run the 6-stage LLM analysis pipeline. Requires API key.

**Body:** `{ workflowId: string, sessionIds: string[] }`

**Response:** `{ workflowId, definition: WorkflowDefinition, confidence, stages }`

## Config

### `POST /config/api-key`
Store the Anthropic API key.

**Body:** `{ apiKey: string }`

**Response:** `{ configured: true }`

### `GET /config/api-key`
Check if API key is configured. Returns true if either a direct API key or `CLAUDE_PROXY_URL` is set.

**Response:** `{ configured: boolean }`

## Proxy Support

The engine supports routing Claude calls through a billing proxy via the `CLAUDE_PROXY_URL` environment variable. When set, the Anthropic SDK's `baseURL` is overridden and `apiKey` is set to `'proxy-managed'` (the proxy injects the real key).

```bash
# Direct mode (default, requires user's API key)
ANTHROPIC_API_KEY=sk-ant-... node engine/dist/server.js

# Proxy mode (macOS app uses this)
CLAUDE_PROXY_URL=https://api.mcpmaker.com/v1/claude node engine/dist/server.js
```

The proxy handles authentication, metering, and tier enforcement. The engine is unaware of which mode it runs in beyond the `baseURL` override.

## Intelligent Playback

All playback endpoints require the API key to be configured.

### `POST /playback/next-action`
Send screenshot + DOM snapshot to Claude, get the next action.

**Body:** `NextActionRequest`
```typescript
{
  screenshot: string;        // base64 PNG (no data URI prefix)
  domSnapshot: PageSnapshot; // from CAPTURE_PAGE_SNAPSHOT
  context: PlaybackContext;  // full action history, intent, params, insights
  mode: 'guided' | 'generative' | 'recovery';
}
```

**Response:** `NextActionResponse`
```typescript
{
  action: {
    type: 'click' | 'input' | 'select' | 'keydown' | 'navigate' | 'wait' | 'scroll' | 'done' | 'fail';
    elementIndex?: number;   // index from snapshot's interactive elements
    value?: string;
    reasoning: string;
    confidence: number;      // 0.0 to 1.0
  };
  stepAdvanced: boolean;
  workflowComplete: boolean;
}
```

### `POST /playback/intent`
Extract a plain-English workflow intent from a definition + parameters.

**Body:** `{ definition: WorkflowDefinition, parameters: Record<string, ...> }`

**Response:** `{ intent: string }`

### `POST /playback/log`
Save a playback run log for learning over time.

**Body:** `{ entry: PlaybackLogEntry }`

**Response:** `{ saved: true }`

### `GET /playback/insights/:workflowId`
Get past playback insights for a workflow (up to 10, newest first).

**Response:** `{ insights: string[] }`
