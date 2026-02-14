// ============================================================
// MCPMAKER Engine - Claude LLM Client Wrapper
// Handles all AI interactions for the analysis pipeline
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../database.js';
import type {
  NetworkEvent,
  DOMEvent,
  NextActionRequest,
  NextActionResponse,
  WorkflowDefinition,
  PageSnapshot,
  PlaybackContext,
  PlaybackMode,
} from '../types.js';

let client: Anthropic | null = null;

const MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ---- Auth Header Redaction ----

const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      // Keep enough to identify the pattern, redact the actual value
      if (value.startsWith('Bearer ')) {
        redacted[key] = 'Bearer [REDACTED_TOKEN]';
      } else if (value.length > 20) {
        redacted[key] = `${value.substring(0, 8)}...[REDACTED]`;
      } else {
        redacted[key] = '[REDACTED]';
      }
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function redactNetworkEvent(event: NetworkEvent): NetworkEvent {
  return {
    ...event,
    requestHeaders: redactHeaders(event.requestHeaders),
    responseHeaders: redactHeaders(event.responseHeaders),
  };
}

// ---- Client Management ----

function getClient(): Anthropic {
  if (client) return client;

  const proxyUrl = process.env.CLAUDE_PROXY_URL;

  if (proxyUrl) {
    // When using the cloud proxy, the proxy manages the real API key.
    // We pass a placeholder so the SDK doesn't reject the missing key.
    client = new Anthropic({
      apiKey: 'proxy-managed',
      baseURL: proxyUrl,
    });
    return client;
  }

  const apiKey = getConfig('anthropic_api_key');
  if (!apiKey) {
    throw new Error(
      'Anthropic API key not configured. Please set it via POST /config/api-key before running analysis.'
    );
  }

  client = new Anthropic({ apiKey });
  return client;
}

export function resetClient(): void {
  client = null;
}

// ---- Retry Logic ----

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(fn: () => Promise<string>): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error as Error;
      const errMsg = (error as Error).message || '';

      // Rate limit - back off exponentially
      if (errMsg.includes('rate_limit') || errMsg.includes('429')) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      // Overloaded - back off
      if (errMsg.includes('overloaded') || errMsg.includes('529')) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`API overloaded, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }

      // Other errors - don't retry
      throw error;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

// ---- Core LLM Call ----

export async function chat(systemPrompt: string, userMessage: string): Promise<string> {
  return callWithRetry(async () => {
    const anthropic = getClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }
    return textBlock.text;
  });
}

// ---- JSON Extraction Helper ----

function extractJson(text: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON (array or object)
  const jsonMatch = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

async function chatJson<T>(systemPrompt: string, userMessage: string): Promise<T> {
  const response = await chat(systemPrompt, userMessage);
  const jsonStr = extractJson(response);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    throw new Error(`Failed to parse LLM JSON response: ${(e as Error).message}\nRaw response:\n${response}`);
  }
}

// ---- Multimodal (Vision) LLM Calls ----

async function chatVision(
  systemPrompt: string,
  screenshotBase64: string,
  textMessage: string
): Promise<string> {
  return callWithRetry(async () => {
    const anthropic = getClient();
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: screenshotBase64,
              },
            },
            { type: 'text', text: textMessage },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }
    return textBlock.text;
  });
}

async function chatVisionJson<T>(
  systemPrompt: string,
  screenshotBase64: string,
  textMessage: string
): Promise<T> {
  const response = await chatVision(systemPrompt, screenshotBase64, textMessage);
  const jsonStr = extractJson(response);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    throw new Error(`Failed to parse vision JSON response: ${(e as Error).message}\nRaw response:\n${response}`);
  }
}

// ---- Intelligent Playback Functions ----

const PLAYBACK_SYSTEM_PROMPT = `You are a browser automation agent. You see a screenshot of the current page and a structured list of interactive elements with their selectors.

Your job: Look at the screenshot, understand what's on the page, and decide what action to take next to accomplish the workflow goal.

RULES:
- Reference elements by their "index" number from the interactive elements list
- The screenshot shows what the user sees; the element list shows what you can interact with
- If a modal/popup is blocking, dismiss it first (close button, X, or click outside)
- If the target element is not visible, try scrolling
- If an input field needs text, use type "input" with the value
- If a dropdown needs selection, use type "select" with the value
- If you need to press a key (Enter, Escape, Tab), use type "keydown" with the key name
- If the page needs time to load, use type "wait"
- Respond with type "done" when the goal is achieved
- Respond with type "fail" only if the workflow absolutely cannot continue (explain why)

CONTEXT AWARENESS:
- You receive the full history of actions taken so far - use this to avoid repeating failed actions
- If the previous action failed, you are in recovery mode - try a different approach
- Consider what steps have been completed to understand where you are in the workflow
- If you see a success confirmation (toast, redirect, updated content), the step may already be done

RESPONSE FORMAT: Respond with ONLY a JSON object, no other text:
{
  "action": {
    "type": "click|input|select|keydown|navigate|wait|scroll|done|fail",
    "elementIndex": <number from interactive elements list, omit for done/fail/wait/scroll>,
    "value": "<text for input/select/keydown/navigate, omit for click>",
    "reasoning": "<brief explanation of why this action>",
    "confidence": <0.0 to 1.0>
  },
  "stepAdvanced": <true if this action completes a workflow step>,
  "workflowComplete": <true only when the entire goal is achieved>
}`;

function buildPlaybackUserMessage(
  domSnapshot: PageSnapshot,
  context: PlaybackContext,
  mode: PlaybackMode
): string {
  const parts: string[] = [];

  // Mode indicator
  parts.push(`## Mode: ${mode.toUpperCase()}`);
  if (mode === 'recovery' && context.lastError) {
    parts.push(`RECOVERY: Previous action failed: "${context.lastError}"`);
    parts.push('Try a different approach to accomplish the same goal.');
  }

  // Workflow intent
  parts.push(`\n## Workflow Goal\n${context.workflowIntent}`);

  // Current step
  if (context.currentStepIntent) {
    parts.push(`\n## Current Step (${(context.currentStepIndex ?? 0) + 1} of ${context.totalSteps ?? context.definedSteps.length})`);
    parts.push(context.currentStepIntent);
  }

  // Defined steps for guided mode
  if (mode === 'guided' && context.definedSteps.length > 0) {
    parts.push('\n## Workflow Steps');
    for (const step of context.definedSteps) {
      const completed = context.completedActions.some(
        (a) => a.success && a.action.reasoning?.includes(`step ${step.order}`)
      );
      parts.push(`${completed ? '[DONE]' : '[TODO]'} ${step.order}. ${step.description}`);
    }
  }

  // Action history - full context for Claude
  if (context.completedActions.length > 0) {
    parts.push('\n## Action History');
    for (const ca of context.completedActions) {
      const status = ca.success ? 'OK' : `FAILED: ${ca.error}`;
      const elInfo = ca.action.elementIndex !== undefined
        ? ` (element #${ca.action.elementIndex})`
        : '';
      const valInfo = ca.action.value ? ` value="${ca.action.value}"` : '';
      parts.push(`- ${ca.action.type}${elInfo}${valInfo} -> ${status} | ${ca.action.reasoning}`);
    }
  }

  // Past insights from previous runs (learning over time)
  if (context.pastInsights && context.pastInsights.length > 0) {
    parts.push('\n## Insights From Previous Runs');
    parts.push('Use these to avoid past mistakes and replicate what worked:');
    for (const insight of context.pastInsights) {
      parts.push(`- ${insight}`);
    }
  }

  // Parameters
  if (Object.keys(context.parameters).length > 0) {
    parts.push('\n## Parameters');
    for (const [key, val] of Object.entries(context.parameters)) {
      parts.push(`- ${key}: ${val}`);
    }
  }

  // Page state
  parts.push(`\n## Current Page\nURL: ${domSnapshot.url}\nTitle: ${domSnapshot.title}`);

  // Navigation context
  if (domSnapshot.navigation.hasModal) {
    parts.push(`\nA MODAL/DIALOG IS OPEN (selector: ${domSnapshot.navigation.modalSelector ?? 'unknown'}). Deal with it first.`);
  }

  // Headings
  if (domSnapshot.headings.length > 0) {
    parts.push('\n## Page Headings');
    for (const h of domSnapshot.headings) {
      parts.push(`${'#'.repeat(h.level)} ${h.text}`);
    }
  }

  // Interactive elements
  parts.push(`\n## Interactive Elements (${domSnapshot.interactiveElements.length} found)`);
  for (const el of domSnapshot.interactiveElements) {
    const desc: string[] = [`[${el.index}] <${el.tag}>`];
    if (el.type) desc.push(`type="${el.type}"`);
    if (el.role) desc.push(`role="${el.role}"`);
    if (el.ariaLabel) desc.push(`aria-label="${el.ariaLabel}"`);
    if (el.textContent) desc.push(`text="${el.textContent}"`);
    if (el.placeholder) desc.push(`placeholder="${el.placeholder}"`);
    if (el.name) desc.push(`name="${el.name}"`);
    if (el.isDisabled) desc.push('DISABLED');
    parts.push(desc.join(' '));
  }

  // Forms
  if (domSnapshot.forms.length > 0) {
    parts.push('\n## Forms');
    for (const form of domSnapshot.forms) {
      parts.push(`Form (${form.selector}):`);
      for (const field of form.fields) {
        const fieldDesc: string[] = [`  - element #${field.elementIndex}`];
        if (field.label) fieldDesc.push(`label="${field.label}"`);
        if (field.name) fieldDesc.push(`name="${field.name}"`);
        if (field.type) fieldDesc.push(`type="${field.type}"`);
        if (field.value) fieldDesc.push(`current="${field.value}"`);
        if (field.required) fieldDesc.push('REQUIRED');
        parts.push(fieldDesc.join(' '));
      }
    }
  }

  return parts.join('\n');
}

export async function getNextPlaybackAction(
  request: NextActionRequest
): Promise<NextActionResponse> {
  const userMessage = buildPlaybackUserMessage(
    request.domSnapshot,
    request.context,
    request.mode
  );

  return chatVisionJson<NextActionResponse>(
    PLAYBACK_SYSTEM_PROMPT,
    request.screenshot,
    userMessage
  );
}

export async function extractWorkflowIntent(
  definition: WorkflowDefinition,
  parameters: Record<string, string | number | boolean>
): Promise<string> {
  const systemPrompt = `You are a workflow summarizer. Given a workflow definition and parameters, produce a clear, plain-English description of what this workflow should accomplish. Be specific about the goal and expected outcome. Keep it to 2-3 sentences.`;

  const steps = definition.steps.map((s) => ({
    order: s.order,
    description: s.description,
    action: s.domAction
      ? `${s.domAction.type} on "${s.domAction.ariaLabel || s.domAction.textContent || s.domAction.selector}"`
      : 'API call',
  }));

  const userMessage = `Workflow: ${definition.name}
Description: ${definition.description}
Base URL: ${definition.baseUrl}

Steps:
${JSON.stringify(steps, null, 2)}

Parameters being used:
${JSON.stringify(parameters, null, 2)}

Summarize what this workflow should do in plain English.`;

  return chat(systemPrompt, userMessage);
}

// ---- Analysis Prompt Functions ----

/**
 * Stage 1: Classify network events as CORE, SUPPORTING, or NOISE
 */
export async function classifyNetworkEvents(
  networkEvents: NetworkEvent[],
  domEvents: DOMEvent[]
): Promise<Array<{ index: number; classification: 'CORE' | 'SUPPORTING' | 'NOISE'; reason: string }>> {
  const systemPrompt = `You are an expert web API analyst. Your job is to classify network requests captured during a browser recording session.

You will receive a list of network events (HTTP requests/responses) and DOM events (user interactions) from a browser recording.

Classify each network event as:
- CORE: This request is directly related to the user's intended action. It's an API call that performs the main business logic (e.g., search API, form submission, data fetch that the user explicitly triggered).
- SUPPORTING: This request supports the user's action but isn't the primary API call (e.g., autocomplete suggestions, validation checks, metadata fetches that happen as side effects).
- NOISE: This request is unrelated to the user's workflow (e.g., analytics, logging, health checks, periodic polling, UI framework internals).

Consider temporal proximity to DOM events, URL patterns, request/response content, and the overall flow of the user's actions.

IMPORTANT: Respond with ONLY a JSON array. Each element must have: { "index": number, "classification": "CORE"|"SUPPORTING"|"NOISE", "reason": string }`;

  const redactedEvents = networkEvents.map(redactNetworkEvent);

  const userMessage = `## Network Events
${JSON.stringify(redactedEvents.map((e, i) => ({
  index: i,
  timestamp: e.timestamp,
  method: e.method,
  url: e.url,
  status: e.responseStatus,
  requestHeaders: Object.keys(e.requestHeaders),
  hasBody: !!e.requestBody,
  responseContentType: e.responseHeaders['content-type'] || 'unknown',
  bodyPreview: e.responseBody ? e.responseBody.substring(0, 200) : null,
})), null, 2)}

## DOM Events (user interactions for context)
${JSON.stringify(domEvents.map((e, i) => ({
  index: i,
  timestamp: e.timestamp,
  type: e.type,
  selector: e.selector,
  elementContext: e.elementContext,
  value: e.value,
  pageUrl: e.pageUrl,
})), null, 2)}`;

  return chatJson(systemPrompt, userMessage);
}

/**
 * Stage 2: Validate correlations between DOM events and network events
 */
export async function validateCorrelations(
  correlations: Array<{
    domEvent: DOMEvent;
    networkEvents: NetworkEvent[];
    timeGap: number;
  }>
): Promise<Array<{
  domEventIndex: number;
  validNetworkIndices: number[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}>> {
  const systemPrompt = `You are an expert at understanding the relationship between user interactions and API calls in web applications.

You will receive a list of proposed correlations between DOM events (user clicks, inputs, etc.) and network events (API calls).

For each correlation, validate whether the network events are truly caused by the DOM event:
- Consider the semantic relationship (e.g., clicking "Search" should correlate with a search API call)
- Consider the timing (network events should happen shortly after the DOM event)
- Consider the data flow (form values should appear in request bodies/params)

Rate each correlation's confidence as high, medium, or low.

IMPORTANT: Respond with ONLY a JSON array. Each element must have: { "domEventIndex": number, "validNetworkIndices": number[], "confidence": "high"|"medium"|"low", "reasoning": string }`;

  const sanitizedCorrelations = correlations.map((c, i) => ({
    index: i,
    domEvent: {
      type: c.domEvent.type,
      selector: c.domEvent.selector,
      elementContext: c.domEvent.elementContext,
      value: c.domEvent.value,
      pageUrl: c.domEvent.pageUrl,
    },
    networkEvents: c.networkEvents.map((n, ni) => ({
      networkIndex: ni,
      method: n.method,
      url: n.url,
      status: n.responseStatus,
      hasBody: !!n.requestBody,
      bodyPreview: n.requestBody ? n.requestBody.substring(0, 200) : null,
    })),
    timeGap: c.timeGap,
  }));

  const userMessage = JSON.stringify(sanitizedCorrelations, null, 2);
  return chatJson(systemPrompt, userMessage);
}

/**
 * Stage 3: Parameterize workflow by analyzing differences across recordings
 */
export async function parameterizeWorkflow(
  diffAnalysis: {
    step: number;
    url: string;
    method: string;
    varyingParts: Array<{
      location: 'path' | 'query' | 'body' | 'header';
      key: string;
      values: string[];
    }>;
    domContext: {
      type: string;
      selector: string;
      elementContext: string;
      value?: string;
    } | null;
  }[]
): Promise<Array<{
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  example: string;
  usedIn: { step: number; location: 'path' | 'query' | 'body' | 'header'; key: string }[];
}>> {
  const systemPrompt = `You are an expert API designer. Your job is to identify and name parameters in a workflow based on the variable parts observed across multiple recordings.

You will receive a diff analysis showing which parts of API requests vary between recordings, along with DOM context showing what the user interacted with.

For each varying part, determine:
1. A clear, descriptive parameter name (camelCase, e.g., "searchQuery", "artistName", "pageNumber")
2. The appropriate type (string, number, or boolean)
3. Whether it's required
4. A human-readable description
5. An example value
6. Which steps and locations use this parameter

If multiple varying parts across steps represent the same user input (e.g., a search term used in both the URL and body), merge them into a single parameter.

IMPORTANT: Respond with ONLY a JSON array of parameter definitions.`;

  const userMessage = JSON.stringify(diffAnalysis, null, 2);
  return chatJson(systemPrompt, userMessage);
}

/**
 * Stage 4: Validate step chains and identify dependencies
 */
export async function validateStepChains(
  chains: Array<{
    fromStep: number;
    toStep: number;
    fromUrl: string;
    toUrl: string;
    dataFlows: Array<{
      sourceJsonPath: string;
      sourceValue: string;
      targetLocation: 'path' | 'query' | 'body' | 'header';
      targetKey: string;
      targetValue: string;
    }>;
  }>,
  steps: Array<{
    order: number;
    method: string;
    url: string;
    description: string;
  }>
): Promise<Array<{
  fromStep: number;
  toStep: number;
  confirmed: boolean;
  inputMappings: Array<{
    sourceStep: number;
    sourceJsonPath: string;
    targetLocation: 'path' | 'query' | 'body' | 'header';
    targetKey: string;
    description: string;
  }>;
  reasoning: string;
  isParallel: boolean;
  isPagination: boolean;
}>> {
  const systemPrompt = `You are an expert at analyzing API call chains and data dependencies.

You will receive proposed data flow chains between API steps, along with step descriptions.

For each proposed chain:
1. Confirm or reject whether the data truly flows from step A's response to step B's request
2. Generate proper input mappings (JSON paths for extraction)
3. Identify if steps can run in parallel (no data dependency)
4. Detect pagination patterns (same endpoint called repeatedly with offset/page changes)

Consider:
- IDs from creation responses used in subsequent requests
- Pagination tokens or cursors
- Authentication tokens passed between steps
- Search results used as input to detail fetches

IMPORTANT: Respond with ONLY a JSON array. Each element must have: { "fromStep": number, "toStep": number, "confirmed": boolean, "inputMappings": [...], "reasoning": string, "isParallel": boolean, "isPagination": boolean }`;

  const userMessage = `## Proposed Chains
${JSON.stringify(chains, null, 2)}

## Step Context
${JSON.stringify(steps, null, 2)}`;

  return chatJson(systemPrompt, userMessage);
}

/**
 * Stage 6: Generate the final workflow definition description and tool metadata
 */
export async function generateWorkflowMetadata(
  workflowName: string,
  steps: Array<{
    order: number;
    method: string;
    url: string;
    description: string;
  }>,
  parameters: Array<{
    name: string;
    type: string;
    description: string;
  }>,
  baseUrl: string
): Promise<{
  description: string;
  toolDescription: string;
  returnDescription: string;
  returnFields: Array<{
    name: string;
    type: string;
    description: string;
    sourceStep: number;
    sourceJsonPath: string;
  }>;
}> {
  const systemPrompt = `You are an expert technical writer specializing in API documentation.

Given a workflow's steps, parameters, and base URL, generate:
1. A clear description of what the workflow does (1-2 sentences)
2. A tool description suitable for an MCP tool (concise, action-oriented)
3. A description of what the workflow returns
4. Return field definitions (what data the workflow extracts from the final response)

Focus on the user's perspective - what does this workflow accomplish?

IMPORTANT: Respond with ONLY a JSON object with keys: description, toolDescription, returnDescription, returnFields (array with name, type, description, sourceStep, sourceJsonPath).`;

  const userMessage = `## Workflow: ${workflowName}
Base URL: ${baseUrl}

## Steps
${JSON.stringify(steps, null, 2)}

## Parameters
${JSON.stringify(parameters, null, 2)}`;

  return chatJson(systemPrompt, userMessage);
}

/**
 * Detect auth patterns from request headers across sessions
 */
export async function detectAuthPatterns(
  headerAnalysis: {
    consistentHeaders: Record<string, string[]>;
    consistentCookies: Record<string, string[]>;
    consistentQueryParams: Record<string, string[]>;
  }
): Promise<{
  type: 'cookie' | 'bearer' | 'api_key' | 'custom';
  credentialFields: Array<{
    name: string;
    description: string;
    location: 'header' | 'cookie' | 'query';
  }>;
  reasoning: string;
}> {
  const systemPrompt = `You are a web security expert analyzing authentication patterns in HTTP requests.

You will receive headers, cookies, and query parameters that are consistent across multiple recording sessions.

Identify the authentication mechanism:
- "cookie": Session cookies are the primary auth mechanism
- "bearer": Bearer/JWT tokens in Authorization header
- "api_key": API keys passed in headers or query params
- "custom": Other or mixed authentication

For each credential field, provide:
- A clear name (e.g., "sessionToken", "apiKey", "csrfToken")
- A description of what it is
- Where it's located (header, cookie, or query)

Also identify CSRF tokens if present.

IMPORTANT: Respond with ONLY a JSON object with keys: type, credentialFields (array), reasoning.`;

  // Redact actual values but keep structure
  const redactedAnalysis = {
    consistentHeaders: Object.fromEntries(
      Object.entries(headerAnalysis.consistentHeaders).map(([k, v]) => [
        k,
        v.map((val) =>
          SENSITIVE_HEADERS.includes(k.toLowerCase())
            ? `[VALUE_${val.length}_CHARS]`
            : val
        ),
      ])
    ),
    consistentCookies: Object.fromEntries(
      Object.entries(headerAnalysis.consistentCookies).map(([k, v]) => [
        k,
        v.map((val) => `[VALUE_${val.length}_CHARS]`),
      ])
    ),
    consistentQueryParams: headerAnalysis.consistentQueryParams,
  };

  const userMessage = JSON.stringify(redactedAnalysis, null, 2);
  return chatJson(systemPrompt, userMessage);
}
