# Tap - Watch. Learn. Replace the Browser.

**Status**: Design / MVP Planning
**Date**: 2026-02-12

---

## 1. Problem

Every day, millions of people repeat the same web workflows manually: check order status in a vendor portal, copy invoice data into a spreadsheet, submit expense reports across two systems, update CRM records from email threads.

AI agents could do this for them. But agents need machine-friendly interfaces - APIs, MCP servers, structured endpoints. Most of these web apps don't have them. The legacy vendor portal from 2011 has no API. The government procurement system has no webhook. The internal HR tool has nothing but a browser UI.

The current answer is browser automation: teach an agent to click buttons and fill forms like a human. This works, but it's slow, fragile, expensive (LLM calls per click), and fundamentally the wrong abstraction. The browser UI is a rendering layer for humans. Underneath it, nearly every web app is already making structured API calls. We just can't see them.

**Tap watches you use the web app, captures the API calls happening underneath, and generates an MCP server that replaces the browser entirely.**

## 2. Product Vision

### The 30-second pitch

Install a Chrome extension. Use your web apps normally for a few sessions. Tap correlates your clicks with the network requests underneath, identifies the real API patterns, and auto-generates an MCP server. Now any AI agent can do what you just did - but through clean API calls, not browser automation. No browser needed. No screenshots. No DOM selectors. Just direct, fast, reliable machine-to-machine communication.

### The compounding insight

Every workflow Tap observes makes the browser layer less necessary. Over time, Tap builds a library of "unwrapped" APIs for web apps that never intended to have public APIs. The more people use it, the more apps get mapped. It's a network effect on API discovery.

### What Tap is NOT

- Not a browser automation tool (that's the thing it replaces)
- Not a web scraper (it captures structured API calls, not HTML)
- Not an API documentation tool (it generates runnable MCP servers, not docs)
- Not a recording/replay tool (it parameterizes and generalizes, not just replays)

## 3. How It Works (High Level)

```
                  OBSERVE                    ANALYZE                    GENERATE
             +--------------+          +----------------+         +----------------+
   User      |   Chrome     |  record  |   LLM-powered  |  emit   |   MCP Server   |
   uses  --> |   Extension  |  ------> |   Analysis     |  -----> |   Generator    |
   web app   |              |          |   Pipeline     |         |                |
             | - DOM events |          | - Correlate    |         | - Typed tools  |
             | - Network    |          |   clicks->APIs |         | - Auth handler |
             |   requests   |          | - Parameterize |         | - Ready to run |
             | - Context    |          | - Validate     |         |                |
             +--------------+          +----------------+         +----------------+
                                                                        |
                                                                        v
                                                                  +-----------+
                                                                  | AI agents |
                                                                  | call MCP  |
                                                                  | tools     |
                                                                  | directly  |
                                                                  +-----------+
```

### Three phases:

1. **Observe** - Extension records DOM interactions + network traffic in parallel, tagged with timestamps so they can be correlated
2. **Analyze** - LLM examines recordings, identifies which network calls matter (vs analytics/tracking noise), extracts the parameterizable patterns, maps them to the user's intent
3. **Generate** - Produces a working MCP server with typed tools matching the observed workflows

## 4. User Flow (Step by Step)

### First-time setup
1. User installs Tap Chrome extension
2. Extension adds a small floating "Tap" button to every page (can be minimized)

### Recording a workflow
1. User clicks "Start Recording" on the Tap button
2. User names the workflow in plain English: "Check order status"
3. User performs the workflow normally in the browser
4. Extension silently records:
   - Every DOM interaction (click, type, select, navigate) with element context
   - Every network request/response (URL, method, headers, body, status, response body)
   - Timestamps linking DOM events to network events
   - Page URL and navigation changes
5. User clicks "Stop Recording"
6. Extension shows: "Captured 3 actions, 7 API calls. Record again for better accuracy or generate now?"

### Improving accuracy (optional but encouraged)
1. User records the same workflow 2-3 more times with different inputs
   - First time: checked order #1234
   - Second time: checked order #5678
   - Third time: checked order #9012
2. Multiple recordings let Tap identify:
   - Which parts are variable (order ID) vs fixed (API endpoint structure)
   - Which network calls are consistent (the real API) vs variable (ads, analytics)
   - The required vs optional parameters

### Generating the MCP server
1. User clicks "Generate" in the extension popup
2. Extension sends recordings to local Tap service (runs on localhost)
3. Analysis pipeline processes recordings (10-30 seconds)
4. User sees a preview:
   ```
   Generated MCP Tool: check_order_status

   Parameters:
     - order_id (string, required): The order ID to look up

   Returns:
     - status (string): Current order status
     - estimated_delivery (string): Expected delivery date
     - tracking_number (string): Shipping tracking number

   Based on: 3 recordings, 2 API calls per workflow
   Confidence: High (consistent pattern across recordings)
   ```
5. User can edit names, descriptions, parameter types
6. User clicks "Deploy" - MCP server starts locally

### Using the generated MCP
1. Any MCP-compatible agent (Claude Code, etc.) can now call `check_order_status`
2. The tool makes the same API calls the browser would have made
3. No browser launched. No DOM. No screenshots. Direct API calls.
4. Response in milliseconds instead of seconds.

## 5. Architecture

### 5.1 Chrome Extension

**Manifest V3** extension with two main capabilities:

#### DOM Observer
- Uses MutationObserver + event listeners to capture user interactions
- For each interaction, captures:
  - Event type (click, input, change, submit, keydown)
  - Element selector (CSS path + attributes + text content + aria labels)
  - Element context (surrounding text, form labels, page title)
  - Value entered (for inputs, sanitized - see Privacy section)
  - Timestamp (performance.now() for sub-ms correlation)
  - Screenshot of clicked region (small crop, for LLM context)

#### Network Interceptor
- Uses `chrome.webRequest` API (Manifest V3: `chrome.declarativeNetRequest` for blocking, service worker + fetch intercept for observation)
- Alternative: inject a service worker that intercepts fetch/XHR
- For each request, captures:
  - URL, method, request headers, request body
  - Response status, response headers, response body
  - Timestamp (correlated with DOM events)
  - Initiator (which script/frame triggered the request)
- **Filtering** (even before LLM analysis):
  - Ignore known tracking domains (Google Analytics, Segment, etc.) via blocklist
  - Ignore static assets (images, CSS, fonts)
  - Ignore WebSocket frames (for MVP)
  - Keep: XHR/fetch to same-origin or known API domains

#### Recording Storage
- Recordings stored in IndexedDB within the extension
- Each recording is a `Session`:
  ```typescript
  interface Session {
    id: string
    workflowName: string
    url: string
    startedAt: number
    endedAt: number
    domEvents: DOMEvent[]
    networkEvents: NetworkEvent[]
    // Correlated after recording
    correlations: Correlation[]
  }

  interface DOMEvent {
    timestamp: number
    type: 'click' | 'input' | 'change' | 'submit' | 'navigate'
    selector: string
    elementContext: string   // surrounding text, labels, aria
    value?: string           // sanitized
    screenshotRegion?: Blob  // small crop around element
  }

  interface NetworkEvent {
    timestamp: number
    url: string
    method: string
    requestHeaders: Record<string, string>
    requestBody?: string
    responseStatus: number
    responseHeaders: Record<string, string>
    responseBody?: string
    initiator: string
  }

  interface Correlation {
    domEvent: DOMEvent
    networkEvents: NetworkEvent[]  // 0 or more network calls triggered by this action
    timeGap: number               // ms between click and first request
  }
  ```

### 5.2 Local Service (Tap Engine)

A local process that the extension communicates with. Handles analysis and generation.

**Why local?**
- Network traffic contains auth tokens, session cookies, PII
- Non-technical users should not need to trust a cloud service with their credentials
- Keeps everything on-device (privacy-first)
- MCP servers run locally anyway

**Stack**: TypeScript + Node.js (single binary via pkg or bun compile)
- Runs on `localhost:7433` (TAP on phone keypad)
- HTTP API for extension communication
- Spawns MCP servers as child processes

#### Endpoints
```
POST /sessions          - Extension sends a completed recording session
GET  /sessions          - List all recorded sessions
POST /analyze           - Trigger analysis pipeline on sessions for a workflow
GET  /workflows         - List generated workflows
POST /workflows/:id/deploy  - Deploy a workflow as an MCP server
GET  /workflows/:id/status  - Check MCP server status
```

### 5.3 Analysis Pipeline (LLM-powered)

This is the core intelligence. Takes raw recordings, produces structured workflow definitions.

#### Stage 1: Noise Filtering
**Goal**: Separate real API calls from noise.

Input: Raw network events from all recordings of a workflow.

Heuristics (pre-LLM, fast):
- Remove requests to known tracking domains (maintain blocklist)
- Remove requests for static assets (by content-type)
- Remove preflight OPTIONS requests (keep the actual request)
- Remove requests that appear in ALL pages (likely analytics, nav, auth refresh)

LLM pass:
- Given remaining requests + DOM events + page context, ask:
  "Which of these network requests are directly related to the user's workflow of '{workflowName}'? The user interacted with elements: {domEventSummary}. Classify each request as: CORE (directly implements the workflow), SUPPORTING (auth, session), or NOISE (unrelated)."

#### Stage 2: Correlation
**Goal**: Map each user action to its resulting API calls.

Use timestamps to correlate:
- A DOM click event at t=1000ms likely triggered network requests at t=1010-1200ms
- Group network events that fall within a window after each DOM event
- Handle async patterns: click -> loading spinner -> API call (longer gap)

LLM validation:
- Given the DOM event context ("user clicked button labeled 'Search Orders' after typing '1234' in field 'Order ID'") and the correlated network request (`GET /api/orders?q=1234`), ask:
  "Does this network request match the user's intent? What parameter in the request corresponds to the user's input?"

#### Stage 3: Parameterization
**Goal**: Identify which parts of API calls are variable vs fixed.

Compare the same workflow across multiple recordings:
```
Recording 1: GET /api/orders?q=1234      -> {id: 1234, status: "shipped"}
Recording 2: GET /api/orders?q=5678      -> {id: 5678, status: "pending"}
Recording 3: GET /api/orders?q=9012      -> {id: 9012, status: "delivered"}
```

Diff analysis:
- URL path: fixed (`/api/orders`)
- Query param `q`: variable (matches user input in DOM event) -> becomes parameter `order_id`
- Response fields: consistent structure -> becomes return type

LLM enrichment:
- Name the parameters based on DOM context ("the input field was labeled 'Order ID', so this parameter is `order_id`")
- Describe what the tool does based on the page context and workflow name
- Infer parameter types from observed values (all numeric -> number, mixed -> string)
- Identify optional vs required parameters (present in all recordings = required)

#### Stage 4: Step Chain Detection
**Goal**: Identify multi-step workflows where data flows between sequential API calls.

This is critical for real-world workflows. Example: "Look up a customer, then create an order for them."

```
Step 1: GET /api/customers?name=Acme     -> { id: 42, name: "Acme Corp" }
Step 2: POST /api/orders  body: { customer_id: 42, items: [...] }
                                          ^^
                            This value came from Step 1's response
```

**Detection algorithm:**

1. **Temporal ordering**: Sort correlated API calls by timestamp within a recording
2. **Data flow analysis**: For each request in step N+1, check if any value in its URL, query params, headers, or body appeared in step N's response
   - Exact match: response field value appears verbatim in next request
   - Structural match: a JSON path from response maps to a JSON path in request
3. **Cross-recording validation**: Verify the chain holds across multiple recordings
   - Recording 1: Step 1 returns `{id: 42}`, Step 2 sends `customer_id: 42` -> chain detected
   - Recording 2: Step 1 returns `{id: 99}`, Step 2 sends `customer_id: 99` -> chain confirmed
   - The variable part (`42` vs `99`) confirms it's a data dependency, not a coincidence

**LLM chain validation:**
Given the step sequence and detected data flows, ask Claude:
"Here is a multi-step API workflow. For each step, I've detected potential data dependencies on previous steps. Validate these chains:
- Step 1 response field `id` -> Step 2 request field `customer_id`: Is this the same entity?
- Are there any data dependencies I missed?
- What is the minimal set of user-provided parameters? (i.e., which inputs does the user need to supply vs what gets resolved by chaining?)"

**Chain representation in WorkflowStep:**

```typescript
interface WorkflowStep {
  order: number
  description: string

  request: {
    method: string
    pathTemplate: string
    headers: Record<string, string>
    bodyTemplate?: string
  }

  // NEW: data flowing in from previous steps
  inputMappings: StepInputMapping[]

  response: {
    expectedStatus: number
    extractFields: FieldExtraction[]
  }

  dependsOn?: number  // which step must complete first
}

interface StepInputMapping {
  // Where does this value come from?
  sourceStep: number
  sourceJsonPath: string      // e.g., "$.id" from step 1's response

  // Where does it go in this step's request?
  targetLocation: 'path' | 'query' | 'body' | 'header'
  targetKey: string           // e.g., "customer_id" in request body

  // Human-readable explanation (LLM-generated)
  description: string         // e.g., "Customer ID from lookup feeds into order creation"
}
```

**Generated MCP server behavior for multi-step:**
1. Execute steps sequentially (respecting `dependsOn`)
2. After each step, extract fields specified in `extractFields`
3. Before each step, resolve `inputMappings` by substituting values from previous step responses
4. If any step fails, return a clear error indicating which step failed and why
5. Final return value can aggregate fields from any/all steps

**Edge cases:**
- Parallel steps (two API calls that don't depend on each other) - detect via absence of data flow, execute concurrently in generated server
- Conditional steps (step 3 only happens if step 2 returns status="active") - defer to post-MVP, but flag to user: "This workflow may have conditional logic that Tap can't fully capture yet"
- Pagination (step repeats with cursor from previous response) - detect the loop pattern, generate a while loop in the MCP server

#### Stage 5: Auth Pattern Detection
**Goal**: Understand how authentication works so the generated MCP server can handle it.

Analyze auth-related headers/cookies across recordings:
- **Cookie-based**: Identify session cookies (same cookie in all requests)
- **Bearer token**: Identify Authorization headers, detect JWT structure
- **API key**: Identify consistent query params or headers that look like keys
- **CSRF tokens**: Identify tokens that change per session, detect how they're obtained

For MVP: extract auth credentials from the recording and let the user paste fresh ones when needed. Full auth flow automation (OAuth, login page) is post-MVP.

#### Stage 5: Workflow Definition
**Goal**: Produce a structured definition that the generator can turn into code.

Output schema:
```typescript
interface WorkflowDefinition {
  name: string                    // "check_order_status"
  description: string             // "Look up the current status of an order"
  confidence: 'high' | 'medium' | 'low'

  steps: WorkflowStep[]

  parameters: ParameterDef[]      // inputs the user provides
  returns: ReturnDef              // structured output

  auth: AuthPattern
  baseUrl: string

  // Metadata
  recordingCount: number
  lastRecorded: string
}

interface WorkflowStep {
  order: number
  description: string             // "Search for the order"

  request: {
    method: string
    pathTemplate: string          // "/api/orders?q={{order_id}}"
    headers: Record<string, string>
    bodyTemplate?: string         // for POST/PUT, with {{param}} placeholders
  }

  response: {
    expectedStatus: number
    extractFields: FieldExtraction[]  // what to pull from response for return value or next step
  }

  dependsOn?: number              // step that must complete first (for chained calls)
}

interface ParameterDef {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description: string
  example: string
  // Which step(s) and where this param is used
  usedIn: { step: number, location: 'path' | 'query' | 'body' | 'header', key: string }[]
}

interface ReturnDef {
  description: string
  fields: {
    name: string
    type: string
    description: string
    source: { step: number, jsonPath: string }
  }[]
}

interface AuthPattern {
  type: 'cookie' | 'bearer' | 'api_key' | 'custom'
  // How to provide credentials when running the MCP tool
  credentialFields: { name: string, description: string, location: 'header' | 'cookie' | 'query' }[]
}
```

### 5.4 MCP Server Generator

Takes a `WorkflowDefinition` and produces a runnable MCP server.

#### Generated server structure
```
~/.tap/servers/{workflow-name}/
  server.ts          # MCP server implementation
  config.json        # Auth credentials (user-provided, gitignored)
  workflow.json      # The WorkflowDefinition (for regeneration)
  README.md          # Auto-generated docs
```

#### Generated server behavior
- Implements MCP protocol (stdio or HTTP transport)
- Exposes one tool per workflow
- Each tool:
  1. Validates input parameters against the schema
  2. Loads auth credentials from config.json
  3. Executes the API calls in step order, substituting parameters
  4. Extracts return fields from responses
  5. Returns structured result
- Error handling:
  - Non-2xx response -> clear error message with status code
  - Auth failure (401/403) -> "Credentials expired, please update config.json"
  - Network error -> retry once, then report
  - Unexpected response shape -> return raw response with warning

#### MCP tool definition (what agents see)
```json
{
  "name": "check_order_status",
  "description": "Look up the current status of an order by its order ID. Returns status, estimated delivery date, and tracking number.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "description": "The order ID to look up (e.g., '1234')"
      }
    },
    "required": ["order_id"]
  }
}
```

### 5.5 Deployment and Registration

When the user clicks "Deploy":
1. Tap Engine writes the generated server files
2. Starts the MCP server process
3. Registers it with Claude Code: `claude mcp add -s user {name} {command}`
4. Confirms to user: "Your 'check_order_status' tool is live. Any AI agent can use it now."

For MVP, servers run as local processes managed by Tap Engine.

## 6. Data Model

```
Session (recording)
  |-- has many DOMEvents
  |-- has many NetworkEvents
  |-- belongs to a Workflow (by name)

Workflow (user-named group)
  |-- has many Sessions
  |-- has one WorkflowDefinition (generated)
  |-- has one MCP Server (deployed)

Server (running MCP process)
  |-- has config (auth credentials)
  |-- has health status
  |-- has usage stats (calls, errors, latency)
```

Storage: SQLite via better-sqlite3 (single file at `~/.tap/tap.db`)

## 7. Privacy and Security

This tool handles sensitive data by nature. Non-negotiable principles:

### Data stays local
- ALL recordings stored on-device only
- ALL analysis happens locally (LLM calls use user's own API key or local model)
- Generated MCP servers run locally
- No telemetry on workflow content, network traffic, or credentials

### Credential handling
- Auth tokens from recordings are NEVER stored in the workflow definition
- User manually provides credentials in `config.json` after generation
- Config files are created with 600 permissions (owner-only read/write)
- `.gitignore` auto-created in server directories

### Recording sanitization
- Passwords typed into fields are captured during recording but:
  - Marked as sensitive based on input type="password" detection
  - Redacted in stored sessions after analysis (replaced with placeholder)
  - Never included in LLM prompts
- User can review and delete any recording

### LLM prompt safety
- Network request/response bodies sent to LLM are truncated to relevant fields
- Headers are filtered: auth headers replaced with `[REDACTED]` before LLM sees them
- The LLM never sees raw auth tokens - only the pattern (e.g., "Bearer token in Authorization header")

## 8. Technical Decisions

### Why Chrome Extension (not proxy)?
- Zero-config for non-technical users (install from Chrome Web Store)
- Direct access to DOM context (labels, aria, visual layout)
- Can correlate DOM events with network events via timestamps
- No certificate trust issues (proxy requires CA cert installation)
- Works with HTTPS without MITM concerns

### Why Claude API (not multi-provider)?
- MCP is an Anthropic-led ecosystem; Claude understands MCP tool semantics natively
- One provider to support = less surface area for MVP
- Claude's extended thinking works well for multi-step chain analysis
- User provides their own `ANTHROPIC_API_KEY`
- Post-MVP: consider local models (Ollama) for fully offline operation

### Why MCP output (not REST SDK)?
- MCP is the native interface for the agent era
- One MCP server works with Claude Code, Claude Desktop, and any MCP client
- Tool descriptions give agents context about when/how to use each tool
- Composable: multiple Tap-generated servers can work together

### Why TypeScript?
- Chrome extension is JS by nature
- MCP SDK is TypeScript-first
- Single language across extension, engine, and generated servers
- `bun` for fast startup of generated servers

## 9. MVP Scope

### In scope (v0.1)
- Chrome extension that records DOM events + network traffic
- Manual start/stop recording via extension UI
- Local Tap Engine that receives and stores recordings
- LLM analysis pipeline (Claude API via user's `ANTHROPIC_API_KEY`)
- **Multi-step workflow generation** (chained API calls where step N's response feeds into step N+1)
- Step chain detection: automatic identification of data flowing between sequential API calls
- MCP server generation and local deployment
- Auto-registration with Claude Code
- Cookie-based and Bearer token auth patterns
- Extension popup showing recorded workflows and their status
- "Try it" validation before deploying

### Out of scope (post-MVP)
- OAuth/login flow automation (user provides creds manually for MVP)
- Workflow sharing / community library of unwrapped APIs
- Cloud deployment of generated MCP servers
- WebSocket / streaming API support
- GraphQL-specific analysis
- Visual workflow editor
- Automatic re-recording when APIs change
- Mobile app observation
- Non-Chrome browsers
- Multi-provider LLM support (OpenAI, Gemini, local models)

### Stretch goals (if MVP goes fast)
- "Tap Suggest" - extension detects repeated workflows and suggests recording
- Confidence scoring with visual indicators in extension
- Conditional branching (different API paths based on response values)

## 10. Key Risks and Mitigations

### Risk: Web apps with no underlying API calls
Some apps do everything server-side (traditional form POSTs with full page reloads, server-rendered HTML). No XHR/fetch to intercept.

**Mitigation**: Detect this pattern early. If Tap sees form submissions returning HTML (not JSON), warn the user: "This app uses server-side rendering. Tap works best with apps that use API calls. For this app, browser automation (Stagehand) may be a better fit." Provide a graceful off-ramp, not a broken experience.

### Risk: Anti-bot / rate limiting on generated API calls
When Tap replays API calls without a browser, the app might detect non-browser traffic.

**Mitigation**: Generated servers replicate the headers observed during recording (User-Agent, Referer, etc.). For MVP, this is likely sufficient. Post-MVP, add header rotation and request timing to match human patterns.

### Risk: APIs that change frequently
The generated MCP server hardcodes API paths and response shapes from recordings.

**Mitigation**: Generated servers validate response shapes at runtime. If the shape changes, the tool returns a clear error: "API response has changed since this tool was generated. Re-record the workflow to update." Post-MVP: auto-detect drift and suggest re-recording.

### Risk: LLM hallucination in analysis
The LLM might misidentify which API calls are relevant, or mis-parameterize.

**Mitigation**:
- Multiple recordings reduce hallucination risk (diff analysis is structural, not LLM-dependent)
- "Try it" validation step: before deploying, Tap replays the workflow with known inputs and compares the result to what was observed during recording
- User reviews the generated tool definition before deploying

### Risk: Complex auth flows
OAuth redirects, MFA, CAPTCHA, rotating tokens.

**Mitigation**: MVP explicitly defers this. User provides working credentials manually. The extension captures the auth pattern (where tokens go) but not the auth flow (how to get them). Post-MVP adds OAuth flow recording and token refresh.

## 11. Testing Strategy

### Extension testing
- Unit tests for DOM event capture (mock DOM, verify event objects)
- Unit tests for network interception (mock requests, verify capture)
- Integration tests against known web apps (build a test app with predictable API calls)
- Manual testing on 5 real-world apps of varying complexity

### Analysis pipeline testing
- Golden file tests: known recordings -> expected WorkflowDefinitions
- Parameterization tests: 3 recordings with known diffs -> correct parameter extraction
- Noise filtering tests: recordings with analytics mixed in -> only real API calls remain
- Auth detection tests: recordings with various auth patterns -> correct classification

### Generated server testing
- Each generated server gets a smoke test: call the tool with known inputs, verify response
- Compare generated server response to recorded response (should match structure)
- Test error paths: invalid inputs, expired auth, changed API

### End-to-end testing
- Build a simple test web app with known API
- Record 3 workflows against it
- Generate MCP server
- Call MCP tools and verify results match direct API calls

## 12. Success Metrics (MVP)

- **Recording success rate**: % of recording sessions that produce a usable WorkflowDefinition (target: >80% for apps with REST APIs)
- **Generation accuracy**: % of generated tools that work correctly on first deploy (target: >70%)
- **Time to first tool**: Time from install to first working MCP tool (target: <10 minutes)
- **Tool latency vs browser**: Generated API call vs equivalent browser automation (target: 10-100x faster)

## 13. Implementation Plan

### Phase 1: Chrome Extension (Week 1-2)
1. Extension scaffold (Manifest V3, popup UI, content script, service worker)
2. DOM event capture (click, input, change, submit, navigate)
3. Network request interception (fetch/XHR via service worker or content script injection)
4. Timestamp correlation (link DOM events to network events by time window)
5. Recording UI (start/stop, name workflow, show captured event count)
6. Export recording as JSON to local engine

### Phase 2: Local Engine + Storage (Week 2-3)
1. Tap Engine scaffold (Node/Bun HTTP server on localhost:7433)
2. SQLite storage for sessions and workflows
3. API endpoints (receive sessions, list workflows)
4. Extension <-> Engine communication (localhost HTTP)

### Phase 3: Analysis Pipeline - Single Step (Week 3-4)
1. Pre-LLM noise filtering (blocklist, content-type, static assets)
2. Timestamp-based correlation (DOM event -> network events within window)
3. LLM noise classification (CORE / SUPPORTING / NOISE) via Claude API
4. Multi-recording diff analysis (identify variable vs fixed parts)
5. Parameter extraction and naming (from DOM context)
6. Auth pattern detection
7. WorkflowDefinition generation (single-step workflows)

### Phase 4: Analysis Pipeline - Multi-Step Chains (Week 4-5)
1. Temporal ordering of correlated API calls within a recording
2. Data flow analysis: detect values from step N response appearing in step N+1 request
3. Cross-recording chain validation (same chain structure across different inputs)
4. LLM chain validation and dependency description via Claude API
5. InputMapping generation (source step/path -> target location/key)
6. Parallel step detection (independent calls that can run concurrently)
7. Pagination loop detection (cursor-based repeat patterns)

### Phase 5: MCP Generation (Week 5-7)
1. Template for MCP server (TypeScript, stdio transport)
2. Single-step code generation from WorkflowDefinition
3. Multi-step code generation: sequential execution with data passing between steps
4. Parallel step execution (concurrent fetch for independent steps)
5. Config file generation (auth credential placeholders)
6. Server startup and health check
7. Auto-registration with Claude Code (`claude mcp add`)
8. "Try it" validation (replay with known inputs, compare to recorded responses)

### Phase 6: Polish and Test (Week 7-8)
1. End-to-end testing against 5+ real web apps (mix of single and multi-step)
2. Error handling and edge cases (step failures mid-chain, auth expiry)
3. Extension UI polish (status indicators, workflow management, step visualization)
4. Documentation (user guide in extension, generated README per server)

## 14. Resolved Decisions

| Decision | Resolution |
|---|---|
| LLM provider | Claude API only (`ANTHROPIC_API_KEY`). Multi-provider post-MVP. |
| Multi-step in MVP | Yes. Core to real-world usefulness. |
| Monetization | Exploratory for now. Build with eventual monetization in mind (see below). |

## 15. Open Questions

1. **Distribution**: Chrome Web Store + Homebrew (for the engine)? Or a single installer that handles both?

2. **Naming**: Working name is "Tap." Alternatives considered: Absorb, Ghost, Peel, Unwrap, Surface. The name should convey "watching and learning" to non-technical users.

3. **Existing art**: Need to investigate if any YC companies or startups are doing exactly this (observation -> API generation). The closest I've seen is Stagehand's caching, but that's still browser-first.

## 16. Monetization Thinking (Future)

Current phase is exploratory - build the tool, validate that it works, use it ourselves.

Potential monetization paths to keep in mind during MVP design:

- **Community workflow library**: Users share generated WorkflowDefinitions (not credentials) for common apps. Free to contribute, paid to access the full library. Network effect: more users = more apps mapped.
- **Cloud-hosted MCP servers**: Run generated servers in the cloud (always-on, no local process needed). Free for local, paid for cloud deployment.
- **Team/enterprise**: Shared workflows across a team, centralized credential management, audit logging. The "who automated what" visibility layer.
- **API marketplace**: Generated MCP servers for popular apps become a marketplace. Tap becomes "the App Store for machine-readable APIs."

Design implications for MVP: keep WorkflowDefinitions portable and shareable (JSON, no local path dependencies). Keep credential storage separate from workflow definitions. These are free to implement now and keep doors open.
