// ============================================================
// MCPMAKER Service Worker
// Background state management, network interception, engine comms
// ============================================================

// Ensure this file is treated as a module
export {};

// --- Inline Types ---

interface DOMEvent {
  timestamp: number;
  type: 'click' | 'input' | 'change' | 'submit' | 'navigate' | 'keydown';
  selector: string;
  elementContext: string;
  value?: string;
  windowId?: number;
  tabId?: number;
  inputType?: string;
  tagName?: string;
  attributes?: Record<string, string>;
  innerText?: string;
  ariaLabel?: string;
  formLabels?: string[];
  pageTitle?: string;
  pageUrl?: string;
}

interface NetworkEvent {
  timestamp: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody?: string;
  initiator: string;
  windowId?: number;
  tabId?: number;
  resourceType?: string;
}

interface Correlation {
  domEventIndex: number;
  networkEventIndices: number[];
  timeGap: number;
}

interface Session {
  id: string;
  workflowName: string;
  url: string;
  startedAt: number;
  endedAt: number;
  domEvents: DOMEvent[];
  networkEvents: NetworkEvent[];
  correlations: Correlation[];
}

interface WorkflowStep {
  order: number;
  description: string;
  domAction?: {
    type: string;
    selector: string;
    fallbackSelectors: string[];
    ariaLabel?: string;
    textContent?: string;
    value?: string;
    parameterRef?: string;
  };
  request: {
    method: string;
    pathTemplate: string;
    headers: Record<string, string>;
    bodyTemplate?: string;
    queryTemplate?: Record<string, string>;
  };
  inputMappings: unknown[];
  response: {
    expectedStatus: number;
    extractFields: unknown[];
  };
  isLoopStep?: boolean;
  loopCondition?: {
    type: string;
    selector?: string;
    jsonPath?: string;
    expectedValue?: string;
  };
  opensPopup?: boolean;
  popupActions?: WorkflowStep[];
}

interface ParameterDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  example: string;
  usedIn: { step: number; location: string; key: string }[];
}

interface WorkflowDefinition {
  name: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';
  steps: WorkflowStep[];
  parameters: ParameterDef[];
  returns: { description: string; fields: unknown[] };
  auth: unknown;
  baseUrl: string;
  recordingCount: number;
  lastRecorded: string;
}

interface Workflow {
  id: string;
  name: string;
  sitePattern: string;
  sessions: string[];
  definition?: WorkflowDefinition;
  mcpServerPath?: string;
  mcpServerStatus?: 'stopped' | 'running' | 'error';
  createdAt: string;
  updatedAt: string;
}

type PlaybackStatus = 'idle' | 'starting' | 'running' | 'paused' | 'completed' | 'error';

interface PlaybackState {
  status: PlaybackStatus;
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  error?: string;
  result?: Record<string, unknown>;
}

interface PlaybackParams {
  workflowId: string;
  parameters: Record<string, string | number | boolean>;
}

// --- Intelligent Playback Types (inline mirrors of engine types) ---

interface PageSnapshot {
  url: string;
  title: string;
  interactiveElements: InteractiveElement[];
  forms: FormSnapshot[];
  navigation: { hasModal: boolean; modalSelector?: string };
  headings: Array<{ level: number; text: string }>;
}

interface InteractiveElement {
  index: number;
  tag: string;
  type?: string;
  selector: string;
  ariaLabel?: string;
  textContent?: string;
  placeholder?: string;
  name?: string;
  role?: string;
  isDisabled: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
}

interface FormSnapshot {
  selector: string;
  fields: Array<{
    elementIndex: number;
    label?: string;
    name?: string;
    type?: string;
    value?: string;
    required: boolean;
  }>;
}

type PlaybackMode = 'guided' | 'generative' | 'recovery';

interface PlaybackAction {
  type: string;
  elementIndex?: number;
  value?: string;
  reasoning: string;
  confidence: number;
}

interface NextActionResponse {
  action: PlaybackAction;
  stepAdvanced: boolean;
  workflowComplete: boolean;
}

interface CompletedAction {
  action: PlaybackAction;
  success: boolean;
  error?: string;
  timestamp: number;
  snapshotUrl?: string;
}

interface PlaybackLogEntry {
  workflowId: string;
  sitePattern: string;
  timestamp: number;
  actions: CompletedAction[];
  outcome: 'completed' | 'failed' | 'partial';
  totalActions: number;
  successfulActions: number;
  insights?: string;
}

// --- Constants ---

const ENGINE_PORT = 7433;
const ENGINE_BASE_URL = `http://localhost:${ENGINE_PORT}`;

const TRACKING_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
  'segment.io', 'segment.com', 'mixpanel.com', 'hotjar.com', 'fullstory.com',
  'mouseflow.com', 'crazyegg.com', 'optimizely.com', 'amplitude.com',
  'heap.io', 'heapanalytics.com', 'intercom.io', 'sentry.io', 'bugsnag.com',
  'rollbar.com', 'newrelic.com', 'datadoghq.com', 'facebook.net',
  'fbevents.com', 'doubleclick.net', 'adservice.google.com',
  'googlesyndication.com', 'googleadservices.com',
];

const STATIC_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.ico', '.map',
];

const CORRELATION_WINDOW_MS = 2000;

// --- State ---

let recordingState = {
  isRecording: false,
  startedAt: 0,
  tabId: 0,
  windowId: 0,
  url: '',
  workflowName: '',
  domEvents: [] as DOMEvent[],
  networkEvents: [] as NetworkEvent[],
};

let playbackState: PlaybackState = {
  status: 'idle',
  currentStep: 0,
  totalSteps: 0,
  completedSteps: [],
};

let playbackController: PlaybackController | null = null;

// --- Pending network requests (for correlating request/response) ---

interface PendingRequest {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  initiator: string;
  timestamp: number;
  tabId?: number;
  resourceType?: string;
}

const pendingRequests = new Map<string, PendingRequest>();

// --- Network Interception ---

function isTrackingUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return TRACKING_DOMAINS.some((domain) => hostname.includes(domain));
  } catch {
    return false;
  }
}

function isStaticAsset(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function shouldCaptureRequest(url: string): boolean {
  if (isTrackingUrl(url)) return false;
  if (isStaticAsset(url)) return false;
  // Skip chrome-extension:// and chrome:// URLs
  if (url.startsWith('chrome') || url.startsWith('moz-extension')) return false;
  // Skip data: URLs
  if (url.startsWith('data:')) return false;
  return true;
}

// Set up webRequest listeners for network capture
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!recordingState.isRecording) return;
    if (!shouldCaptureRequest(details.url)) return;

    const pending: PendingRequest = {
      url: details.url,
      method: details.method,
      requestHeaders: {},
      initiator: details.initiator ?? '',
      timestamp: Date.now(),
      tabId: details.tabId,
      resourceType: details.type,
    };

    // Capture request body if present
    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const decoder = new TextDecoder();
          const parts = details.requestBody.raw.map((part) =>
            part.bytes ? decoder.decode(part.bytes) : ''
          );
          pending.requestBody = parts.join('');
        } catch {
          // Ignore decode errors
        }
      } else if (details.requestBody.formData) {
        pending.requestBody = JSON.stringify(details.requestBody.formData);
      }
    }

    pendingRequests.set(details.requestId, pending);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (!recordingState.isRecording) return;
    const pending = pendingRequests.get(details.requestId);
    if (pending && details.requestHeaders) {
      const headers: Record<string, string> = {};
      for (const h of details.requestHeaders) {
        if (h.name && h.value) {
          headers[h.name] = h.value;
        }
      }
      pending.requestHeaders = headers;
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!recordingState.isRecording) return;

    const pending = pendingRequests.get(details.requestId);
    if (!pending) return;
    pendingRequests.delete(details.requestId);

    const responseHeaders: Record<string, string> = {};
    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        if (h.name && h.value) {
          responseHeaders[h.name] = h.value;
        }
      }
    }

    const networkEvent: NetworkEvent = {
      timestamp: pending.timestamp,
      url: details.url,
      method: pending.method,
      requestHeaders: pending.requestHeaders,
      requestBody: pending.requestBody,
      responseStatus: details.statusCode,
      responseHeaders,
      initiator: pending.initiator,
      tabId: pending.tabId,
      resourceType: pending.resourceType,
    };

    recordingState.networkEvents.push(networkEvent);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    // Clean up pending requests that errored
    pendingRequests.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

// --- Recording Management ---

async function startRecording(workflowName?: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return;

  recordingState = {
    isRecording: true,
    startedAt: Date.now(),
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    workflowName: workflowName ?? '',
    domEvents: [],
    networkEvents: [],
  };

  // Tell content script to start capturing
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING_CONTENT' });
  } catch {
    // Content script might not be injected yet, inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js'],
    });
    // Retry
    await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING_CONTENT' });
  }

  // Set badge to indicate recording
  chrome.action.setBadgeText({ text: 'REC' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

  // Keep service worker alive during recording
  chrome.alarms.create('keepalive', { delayInMinutes: 0.4 });
}

async function stopRecording(): Promise<Session | null> {
  if (!recordingState.isRecording) return null;

  const session = finalizeSession();
  recordingState.isRecording = false;

  // Tell content script to stop
  try {
    await chrome.tabs.sendMessage(recordingState.tabId, {
      type: 'STOP_RECORDING_CONTENT',
    });
  } catch {
    // Tab may have been closed
  }

  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  // Stop keepalive alarm
  chrome.alarms.clear('keepalive');

  return session;
}

function finalizeSession(): Session {
  const correlations = correlateEvents(
    recordingState.domEvents,
    recordingState.networkEvents
  );

  const session: Session = {
    id: generateId(),
    workflowName: recordingState.workflowName,
    url: recordingState.url,
    startedAt: recordingState.startedAt,
    endedAt: Date.now(),
    domEvents: recordingState.domEvents,
    networkEvents: recordingState.networkEvents,
    correlations,
  };

  return session;
}

function correlateEvents(
  domEvents: DOMEvent[],
  networkEvents: NetworkEvent[]
): Correlation[] {
  const correlations: Correlation[] = [];

  for (let i = 0; i < domEvents.length; i++) {
    const domEvent = domEvents[i];
    const matchingNetworkIndices: number[] = [];
    let minGap = Infinity;

    for (let j = 0; j < networkEvents.length; j++) {
      const netEvent = networkEvents[j];
      const gap = netEvent.timestamp - domEvent.timestamp;

      // Network event should happen after (or very close to) the DOM event
      if (gap >= -100 && gap <= CORRELATION_WINDOW_MS) {
        matchingNetworkIndices.push(j);
        if (Math.abs(gap) < Math.abs(minGap)) {
          minGap = gap;
        }
      }
    }

    if (matchingNetworkIndices.length > 0) {
      correlations.push({
        domEventIndex: i,
        networkEventIndices: matchingNetworkIndices,
        timeGap: minGap,
      });
    }
  }

  return correlations;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Session Storage ---

async function saveSession(session: Session): Promise<void> {
  const data = await chrome.storage.local.get('sessions');
  const sessions: Record<string, Session> = data.sessions ?? {};
  sessions[session.id] = session;
  await chrome.storage.local.set({ sessions });
}

async function getSession(id: string): Promise<Session | null> {
  const data = await chrome.storage.local.get('sessions');
  const sessions: Record<string, Session> = data.sessions ?? {};
  return sessions[id] ?? null;
}

// --- Workflow Storage ---

async function saveWorkflow(workflow: Workflow): Promise<void> {
  const data = await chrome.storage.local.get('workflows');
  const workflows: Record<string, Workflow> = data.workflows ?? {};
  workflows[workflow.id] = workflow;
  await chrome.storage.local.set({ workflows });
}

async function getWorkflow(id: string): Promise<Workflow | null> {
  const data = await chrome.storage.local.get('workflows');
  const workflows: Record<string, Workflow> = data.workflows ?? {};
  return workflows[id] ?? null;
}

async function getWorkflowsForSite(sitePattern: string): Promise<Workflow[]> {
  const data = await chrome.storage.local.get('workflows');
  const workflows: Record<string, Workflow> = data.workflows ?? {};
  const all = Object.values(workflows);

  if (!sitePattern) return all;

  return all.filter((wf) => {
    return wf.sitePattern === sitePattern ||
      sitePattern.includes(wf.sitePattern) ||
      wf.sitePattern.includes(sitePattern);
  });
}

// --- Engine Communication ---

async function isEngineAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendSessionToEngine(session: Session): Promise<{ id: string; workflowName: string } | null> {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    return null;
  }
}

async function requestAnalysis(workflowId: string, sessionIds: string[]): Promise<{
  workflowId: string;
  definition: WorkflowDefinition;
  confidence: string;
} | null> {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, sessionIds }),
      signal: AbortSignal.timeout(60000),
    });
    if (response.ok) {
      return await response.json();
    }
    return null;
  } catch {
    return null;
  }
}

// --- Local Analysis Fallback ---

function generateWorkflowFromSession(session: Session): WorkflowDefinition {
  const steps: WorkflowStep[] = [];

  for (let i = 0; i < session.domEvents.length; i++) {
    const evt = session.domEvents[i];

    // Find correlated network events
    const correlation = session.correlations.find((c) => c.domEventIndex === i);
    const networkEvt = correlation
      ? session.networkEvents[correlation.networkEventIndices[0]]
      : null;

    const description = generateStepDescription(evt);

    const step: WorkflowStep = {
      order: i + 1,
      description,
      domAction: {
        type: evt.type,
        selector: evt.selector,
        fallbackSelectors: [],
        ariaLabel: evt.ariaLabel,
        textContent: evt.innerText?.slice(0, 80),
        value: evt.value,
      },
      request: networkEvt
        ? {
            method: networkEvt.method,
            pathTemplate: extractPathTemplate(networkEvt.url),
            headers: networkEvt.requestHeaders,
            bodyTemplate: networkEvt.requestBody,
          }
        : {
            method: 'GET',
            pathTemplate: '',
            headers: {},
          },
      inputMappings: [],
      response: networkEvt
        ? {
            expectedStatus: networkEvt.responseStatus,
            extractFields: [],
          }
        : {
            expectedStatus: 200,
            extractFields: [],
          },
    };

    steps.push(step);
  }

  return {
    name: session.workflowName || generateWorkflowName(session),
    description: `Workflow recorded on ${new URL(session.url).hostname}`,
    confidence: 'low' as const,
    steps,
    parameters: [],
    returns: { description: 'Workflow result', fields: [] },
    auth: { type: 'cookie', credentialFields: [] },
    baseUrl: new URL(session.url).origin,
    recordingCount: 1,
    lastRecorded: new Date().toISOString(),
  };
}

function generateStepDescription(evt: DOMEvent): string {
  const label =
    evt.ariaLabel ||
    (evt.formLabels && evt.formLabels[0]) ||
    evt.innerText?.slice(0, 40) ||
    evt.tagName ||
    'element';

  switch (evt.type) {
    case 'click':
      return `Click "${label}"`;
    case 'input':
      return `Type into "${label}"`;
    case 'change':
      return `Change "${label}"`;
    case 'submit':
      return `Submit form`;
    case 'navigate':
      return `Go to page`;
    case 'keydown':
      return `Press ${evt.value ?? 'key'} on "${label}"`;
    default:
      return `Interact with "${label}"`;
  }
}

function generateWorkflowName(session: Session): string {
  const hostname = new URL(session.url).hostname.replace(/^www\./, '');
  const actions = session.domEvents.filter((e) => e.type === 'click' || e.type === 'submit');
  if (actions.length > 0) {
    const lastAction = actions[actions.length - 1];
    const label = lastAction.ariaLabel || lastAction.innerText?.slice(0, 30) || '';
    if (label) {
      return `${hostname}: ${label}`;
    }
  }
  return `${hostname} workflow`;
}

function extractPathTemplate(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

// --- Post-Recording Pipeline ---

async function processRecordedSession(session: Session): Promise<void> {
  // Save session locally
  await saveSession(session);

  // Notify popup that session is complete
  broadcastMessage({ type: 'SESSION_COMPLETE', session });

  // Check if there's an existing workflow for this site to add the session to
  const sitePattern = new URL(session.url).hostname;
  const existingWorkflows = await getWorkflowsForSite(sitePattern);

  // If session has a workflowName that matches an existing workflow, use that
  let existingWorkflow: Workflow | null = null;
  if (session.workflowName) {
    existingWorkflow = existingWorkflows.find((wf) => wf.name === session.workflowName) ?? null;
  }
  // Otherwise, if there's any workflow for this site, add to the first one
  if (!existingWorkflow && existingWorkflows.length > 0) {
    existingWorkflow = existingWorkflows[0];
  }

  // Try to send to engine for analysis
  const engineUp = await isEngineAvailable();
  let workflow: Workflow;

  if (existingWorkflow) {
    // Add session to existing workflow
    existingWorkflow.sessions.push(session.id);
    existingWorkflow.updatedAt = new Date().toISOString();

    if (engineUp) {
      const engineResult = await sendSessionToEngine(session);
      if (engineResult) {
        // Re-analyze with ALL sessions from this workflow
        const analysis = await requestAnalysis(engineResult.id, existingWorkflow.sessions);
        if (analysis) {
          existingWorkflow.definition = analysis.definition;
        }
      }
    } else {
      // Update local definition with latest session info
      const definition = generateWorkflowFromSession(session);
      existingWorkflow.definition = definition;
    }

    workflow = existingWorkflow;
  } else {
    // Create new workflow
    if (engineUp) {
      const engineResult = await sendSessionToEngine(session);
      if (engineResult) {
        const analysis = await requestAnalysis(engineResult.id, [session.id]);
        if (analysis) {
          workflow = {
            id: engineResult.id,
            name: analysis.definition.name,
            sitePattern,
            sessions: [session.id],
            definition: analysis.definition,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        } else {
          workflow = createLocalWorkflow(session);
        }
      } else {
        workflow = createLocalWorkflow(session);
      }
    } else {
      workflow = createLocalWorkflow(session);
    }
  }

  await saveWorkflow(workflow);
  broadcastMessage({ type: 'ANALYSIS_COMPLETE', workflow });
}

function createLocalWorkflow(session: Session): Workflow {
  const definition = generateWorkflowFromSession(session);
  return {
    id: generateId(),
    name: definition.name,
    sitePattern: new URL(session.url).hostname,
    sessions: [session.id],
    definition,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// --- Intelligent Playback Helpers ---

async function captureScreenshot(): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
  // Strip the "data:image/png;base64," prefix
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

async function checkEngineApiKey(): Promise<boolean> {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/config/api-key`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.configured === true;
    }
    return false;
  } catch {
    return false;
  }
}

async function fetchWorkflowIntent(
  definition: WorkflowDefinition,
  parameters: Record<string, string | number | boolean>
): Promise<string> {
  const response = await fetch(`${ENGINE_BASE_URL}/playback/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ definition, parameters }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch workflow intent: ${response.status}`);
  }
  const data = await response.json();
  return data.intent;
}

async function fetchNextAction(request: {
  screenshot: string;
  domSnapshot: PageSnapshot;
  context: Record<string, unknown>;
  mode: PlaybackMode;
}): Promise<NextActionResponse> {
  const response = await fetch(`${ENGINE_BASE_URL}/playback/next-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch next action: ${response.status}`);
  }
  return response.json();
}

async function savePlaybackLog(entry: PlaybackLogEntry): Promise<void> {
  try {
    await fetch(`${ENGINE_BASE_URL}/playback/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Best effort - don't fail playback if logging fails
    console.warn('Failed to save playback log');
  }
}

async function fetchPlaybackInsights(workflowId: string): Promise<string[]> {
  try {
    const response = await fetch(`${ENGINE_BASE_URL}/playback/insights/${encodeURIComponent(workflowId)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.insights ?? [];
    }
    return [];
  } catch {
    return [];
  }
}

// --- Intelligent Playback Controller ---
// Uses Claude vision + DOM snapshots to drive playback autonomously

class IntelligentPlaybackController {
  private workflow: Workflow;
  private params: Record<string, string | number | boolean>;
  private tabId: number;
  private workflowIntent: string;
  private state: PlaybackState;
  private completedActions: CompletedAction[] = [];
  private lastError: string | null = null;
  private retryCount = 0;
  private currentStepIndex = 0;
  private pastInsights: string[];
  private isStopped = false;
  private isPaused = false;

  constructor(
    workflow: Workflow,
    params: Record<string, string | number | boolean>,
    tabId: number,
    workflowIntent: string,
    pastInsights: string[]
  ) {
    this.workflow = workflow;
    this.params = params;
    this.tabId = tabId;
    this.workflowIntent = workflowIntent;
    this.pastInsights = pastInsights;
    this.state = {
      status: 'starting',
      currentStep: 0,
      totalSteps: workflow.definition?.steps.length ?? 0,
      completedSteps: [],
    };
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    const steps = this.workflow.definition?.steps ?? [];
    if (steps.length === 0) {
      this.state.status = 'error';
      this.state.error = 'This workflow has no steps to run.';
      this.broadcastState();
      return;
    }

    this.state.status = 'running';
    this.broadcastState();

    const MAX_ACTIONS = 100;
    const MAX_RETRIES_PER_STEP = 3;

    try {
      for (let actionCount = 0; actionCount < MAX_ACTIONS; actionCount++) {
        if (this.isStopped) break;

        // Wait while paused
        while (this.isPaused && !this.isStopped) {
          await this.sleep(200);
        }
        if (this.isStopped) break;

        // 1. Capture screenshot
        let screenshot: string;
        try {
          screenshot = await captureScreenshot();
        } catch {
          this.state.status = 'error';
          this.state.error = 'Could not capture a screenshot of the page.';
          this.broadcastState();
          break;
        }

        // 2. Capture DOM snapshot via content script
        let domSnapshot: PageSnapshot;
        try {
          domSnapshot = await chrome.tabs.sendMessage(this.tabId, {
            type: 'CAPTURE_PAGE_SNAPSHOT',
          }) as PageSnapshot;
        } catch {
          // Try injecting content script first
          try {
            await chrome.scripting.executeScript({
              target: { tabId: this.tabId },
              files: ['content-script.js'],
            });
            await this.sleep(300);
            domSnapshot = await chrome.tabs.sendMessage(this.tabId, {
              type: 'CAPTURE_PAGE_SNAPSHOT',
            }) as PageSnapshot;
          } catch {
            this.state.status = 'error';
            this.state.error = 'Could not connect to the page. Please reload and try again.';
            this.broadcastState();
            break;
          }
        }

        // 3. Auto-select mode
        const currentStep = steps[this.currentStepIndex];
        let mode: PlaybackMode;
        if (this.lastError) {
          mode = 'recovery';
        } else if (currentStep) {
          mode = 'guided';
        } else {
          mode = 'generative';
        }

        // 4. Build context with full action history + past insights
        const context = {
          workflowIntent: this.workflowIntent,
          currentStepIntent: currentStep?.description,
          currentStepIndex: this.currentStepIndex,
          totalSteps: steps.length,
          completedActions: this.completedActions,
          parameters: this.params,
          definedSteps: steps.map((s) => ({ order: s.order, description: s.description })),
          lastError: this.lastError ?? undefined,
          pastInsights: this.pastInsights.length > 0 ? this.pastInsights : undefined,
        };

        // 5. Ask Claude for next action
        let response: NextActionResponse;
        try {
          response = await fetchNextAction({
            screenshot,
            domSnapshot,
            context,
            mode,
          });
        } catch (err) {
          this.state.status = 'error';
          this.state.error = `Could not reach the analysis engine: ${err instanceof Error ? err.message : String(err)}`;
          this.broadcastState();
          break;
        }

        const action = response.action;

        // 6. Handle done
        if (action.type === 'done') {
          this.state.status = 'completed';
          this.state.result = {
            stepsCompleted: this.state.completedSteps.length,
            totalActions: this.completedActions.length,
          };
          this.broadcastState();
          await this.saveLog('completed');
          return;
        }

        // 7. Handle fail
        if (action.type === 'fail') {
          this.state.status = 'error';
          this.state.error = action.reasoning || 'Claude determined the workflow cannot continue.';
          this.broadcastState();
          await this.saveLog('failed');
          return;
        }

        // 8. Handle wait/scroll actions (no element needed)
        if (action.type === 'wait') {
          this.completedActions.push({
            action,
            success: true,
            timestamp: Date.now(),
            snapshotUrl: domSnapshot.url,
          });
          await this.sleep(2000);
          continue;
        }

        if (action.type === 'scroll') {
          try {
            await chrome.tabs.sendMessage(this.tabId, {
              type: 'EXECUTE_DOM_ACTION',
              action: { type: 'keydown', selector: 'body', value: 'PageDown' },
            });
            this.completedActions.push({
              action,
              success: true,
              timestamp: Date.now(),
              snapshotUrl: domSnapshot.url,
            });
          } catch {
            this.completedActions.push({
              action,
              success: false,
              error: 'Could not scroll the page.',
              timestamp: Date.now(),
              snapshotUrl: domSnapshot.url,
            });
          }
          await this.sleep(500);
          continue;
        }

        if (action.type === 'navigate' && action.value) {
          try {
            await chrome.tabs.update(this.tabId, { url: action.value });
            await this.waitForPageStable();
            this.completedActions.push({
              action,
              success: true,
              timestamp: Date.now(),
              snapshotUrl: action.value,
            });
            this.lastError = null;
          } catch {
            this.completedActions.push({
              action,
              success: false,
              error: 'Navigation failed.',
              timestamp: Date.now(),
            });
            this.lastError = 'Navigation failed.';
          }
          continue;
        }

        // 9. Resolve elementIndex to selector from snapshot
        let selector: string | null = null;
        if (action.elementIndex !== undefined && action.elementIndex < domSnapshot.interactiveElements.length) {
          selector = domSnapshot.interactiveElements[action.elementIndex].selector;
        }

        if (!selector) {
          this.completedActions.push({
            action,
            success: false,
            error: `Element index ${action.elementIndex} not found in snapshot.`,
            timestamp: Date.now(),
            snapshotUrl: domSnapshot.url,
          });
          this.lastError = `Element index ${action.elementIndex} not found in snapshot.`;
          this.retryCount++;
          if (this.retryCount >= MAX_RETRIES_PER_STEP) {
            this.state.status = 'error';
            this.state.error = `Failed after ${MAX_RETRIES_PER_STEP} retries: could not find the target element.`;
            this.broadcastState();
            await this.saveLog('failed');
            return;
          }
          continue;
        }

        // Highlight first
        try {
          await chrome.tabs.sendMessage(this.tabId, {
            type: 'HIGHLIGHT_ELEMENT',
            selector,
            duration: 600,
          });
          await this.sleep(400);
        } catch {
          // Non-critical
        }

        // 10. Execute via EXECUTE_DOM_ACTION
        let result: { success: boolean; error?: string };
        try {
          result = await chrome.tabs.sendMessage(this.tabId, {
            type: 'EXECUTE_DOM_ACTION',
            action: {
              type: action.type,
              selector,
              value: action.value,
            },
          }) as { success: boolean; error?: string };
        } catch {
          result = { success: false, error: 'Could not reach the page.' };
        }

        // 11. If failed + element not found, try other tabs
        if (!result.success && result.error?.includes('not find the element')) {
          const tabs = await chrome.tabs.query({ currentWindow: true });
          for (const tab of tabs) {
            if (!tab.id || tab.id === this.tabId) continue;
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-script.js'],
              });
              await this.sleep(200);
              const found = await chrome.tabs.sendMessage(tab.id, {
                type: 'FIND_ELEMENT',
                selector,
              }) as { found: boolean };
              if (found.found) {
                this.tabId = tab.id;
                result = await chrome.tabs.sendMessage(tab.id, {
                  type: 'EXECUTE_DOM_ACTION',
                  action: {
                    type: action.type,
                    selector,
                    value: action.value,
                  },
                }) as { success: boolean; error?: string };
                break;
              }
            } catch {
              continue;
            }
          }
        }

        // 12. Record result
        this.completedActions.push({
          action,
          success: result.success,
          error: result.error,
          timestamp: Date.now(),
          snapshotUrl: domSnapshot.url,
        });

        if (!result.success) {
          this.lastError = result.error ?? 'Action failed.';
          this.retryCount++;
          if (this.retryCount >= MAX_RETRIES_PER_STEP) {
            this.state.status = 'error';
            this.state.error = `Failed after ${MAX_RETRIES_PER_STEP} retries: ${this.lastError}`;
            this.broadcastState();
            await this.saveLog('failed');
            return;
          }
        } else {
          this.lastError = null;
          this.retryCount = 0;

          // Advance step if Claude says so
          if (response.stepAdvanced && this.currentStepIndex < steps.length - 1) {
            this.currentStepIndex++;
            this.state.currentStep = this.currentStepIndex;
            this.state.completedSteps.push(this.currentStepIndex - 1);
            this.broadcastState();
          }
        }

        // 13. Wait for page stability
        await this.waitForPageStable();
      }

      // If we exit the loop without completing, save as partial
      if (this.state.status === 'running') {
        this.state.status = 'completed';
        this.state.result = {
          stepsCompleted: this.state.completedSteps.length,
          totalActions: this.completedActions.length,
          note: 'Reached action limit',
        };
        this.broadcastState();
        await this.saveLog('partial');
      }
    } catch (err) {
      this.state.status = 'error';
      this.state.error = err instanceof Error ? err.message : 'Something went wrong during intelligent playback.';
      this.broadcastState();
      await this.saveLog('failed');
    }
  }

  private async saveLog(outcome: 'completed' | 'failed' | 'partial'): Promise<void> {
    const entry: PlaybackLogEntry = {
      workflowId: this.workflow.id,
      sitePattern: this.workflow.sitePattern,
      timestamp: Date.now(),
      actions: this.completedActions,
      outcome,
      totalActions: this.completedActions.length,
      successfulActions: this.completedActions.filter((a) => a.success).length,
      insights: this.generateInsights(outcome),
    };
    await savePlaybackLog(entry);
  }

  private generateInsights(outcome: 'completed' | 'failed' | 'partial'): string {
    const parts: string[] = [];

    if (outcome === 'completed') {
      parts.push(`Workflow completed successfully in ${this.completedActions.length} actions.`);
    } else if (outcome === 'failed') {
      parts.push(`Workflow failed after ${this.completedActions.length} actions.`);
      if (this.lastError) {
        parts.push(`Last error: ${this.lastError}`);
      }
    } else {
      parts.push(`Workflow partially completed with ${this.completedActions.filter((a) => a.success).length}/${this.completedActions.length} successful actions.`);
    }

    // Summarize what worked
    const successfulTypes = this.completedActions
      .filter((a) => a.success)
      .map((a) => a.action.type);
    if (successfulTypes.length > 0) {
      const typeCounts: Record<string, number> = {};
      for (const t of successfulTypes) {
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      }
      parts.push(`Successful actions: ${Object.entries(typeCounts).map(([t, c]) => `${t}(${c})`).join(', ')}`);
    }

    // Note failed actions for future avoidance
    const failedActions = this.completedActions.filter((a) => !a.success);
    if (failedActions.length > 0) {
      const failReasons = [...new Set(failedActions.map((a) => a.error).filter(Boolean))];
      parts.push(`Failures encountered: ${failReasons.slice(0, 3).join('; ')}`);
    }

    return parts.join(' ');
  }

  private async waitForPageStable(): Promise<void> {
    await this.sleep(500);
    try {
      const tab = await chrome.tabs.get(this.tabId);
      if (tab.status === 'loading') {
        let waited = 0;
        while (waited < 10000) {
          await this.sleep(300);
          waited += 300;
          const currentTab = await chrome.tabs.get(this.tabId);
          if (currentTab.status === 'complete') break;
        }
      }
    } catch {
      // Tab might have been closed
    }
  }

  pause(): void {
    this.isPaused = true;
    this.state.status = 'paused';
    this.broadcastState();
  }

  resume(): void {
    this.isPaused = false;
    this.state.status = 'running';
    this.broadcastState();
  }

  stop(): void {
    this.isStopped = true;
    this.state.status = 'idle';
    this.broadcastState();
  }

  private broadcastState(): void {
    broadcastMessage({ type: 'PLAYBACK_UPDATE', state: this.getState() });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// --- Playback Controller ---

class PlaybackController {
  private workflow: Workflow;
  private params: Record<string, string | number | boolean>;
  private state: PlaybackState;
  private isPaused = false;
  private isStopped = false;
  private debuggerTabId: number | null = null;
  private tabId: number;
  private originalTabId: number;
  private pendingNewTab: chrome.tabs.Tab | null = null;
  private tabCreatedListener: ((tab: chrome.tabs.Tab) => void) | null = null;
  private tabRemovedListener: ((tabId: number) => void) | null = null;

  constructor(
    workflow: Workflow,
    params: Record<string, string | number | boolean>,
    tabId: number
  ) {
    this.workflow = workflow;
    this.params = params;
    this.tabId = tabId;
    this.originalTabId = tabId;
    this.state = {
      status: 'starting',
      currentStep: 0,
      totalSteps: workflow.definition?.steps.length ?? 0,
      completedSteps: [],
    };
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    const steps = this.workflow.definition?.steps ?? [];
    if (steps.length === 0) {
      this.state.status = 'error';
      this.state.error = 'This workflow has no steps to run.';
      this.broadcastState();
      return;
    }

    this.state.status = 'running';
    this.broadcastState();

    // Start listening for new tabs (popups/OAuth windows)
    this.startTabMonitoring();

    // Show playback overlay in content script
    this.updateContentOverlay();

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.isStopped) break;

        // Wait while paused
        while (this.isPaused && !this.isStopped) {
          await this.sleep(200);
        }
        if (this.isStopped) break;

        this.state.currentStep = i;
        this.broadcastState();
        this.updateContentOverlay();

        const step = steps[i];
        await this.executeStep(step, i);

        this.state.completedSteps.push(i);
        this.broadcastState();
        this.updateContentOverlay();

        // Brief pause between steps for visual feedback
        await this.sleep(300);
      }

      if (!this.isStopped) {
        this.state.status = 'completed';
        this.state.result = { stepsCompleted: this.state.completedSteps.length };
        this.broadcastState();
      }
    } catch (err) {
      this.state.status = 'error';
      this.state.error = err instanceof Error ? err.message : 'Something went wrong while running the workflow.';
      this.broadcastState();
    }

    // Clean up
    this.stopTabMonitoring();
    this.hideContentOverlay();

    // Detach debugger if attached
    if (this.debuggerTabId !== null) {
      try {
        await chrome.debugger.detach({ tabId: this.debuggerTabId });
      } catch {
        // Already detached
      }
      this.debuggerTabId = null;
    }
  }

  private async executeStep(step: WorkflowStep, index: number): Promise<void> {
    if (!step.domAction) {
      // No DOM action, skip (or it's purely an API step)
      return;
    }

    const action = step.domAction;

    // Perform variable substitution
    let value = action.value;
    if (action.parameterRef && this.params[action.parameterRef] !== undefined) {
      value = String(this.params[action.parameterRef]);
    }

    // Clear any pending new tab from previous step
    this.pendingNewTab = null;

    // Highlight the element first
    try {
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'HIGHLIGHT_ELEMENT',
        selector: action.selector,
        duration: 600,
      });
    } catch {
      // Content script not available - element might be in a different tab
      // Try to find it in any open tab
      const switched = await this.tryFindElementInOtherTabs(action);
      if (switched) {
        try {
          await chrome.tabs.sendMessage(this.tabId, {
            type: 'HIGHLIGHT_ELEMENT',
            selector: action.selector,
            duration: 600,
          });
        } catch {
          // Still can't highlight, continue anyway
        }
      }
    }

    await this.sleep(400);

    // Execute the DOM action
    let result: { success: boolean; error?: string };
    try {
      result = await chrome.tabs.sendMessage(this.tabId, {
        type: 'EXECUTE_DOM_ACTION',
        action: {
          type: action.type,
          selector: action.selector,
          fallbackSelectors: action.fallbackSelectors,
          ariaLabel: action.ariaLabel,
          textContent: action.textContent,
          value,
        },
      }) as { success: boolean; error?: string };
    } catch {
      // Content script not available, try debugger fallback
      result = await this.executeWithDebugger(step, value);
    }

    // If element not found in current tab, check if it's in a popup/new tab
    if (!result.success && result.error?.includes('not find the element')) {
      const switched = await this.tryFindElementInOtherTabs(action);
      if (switched) {
        try {
          result = await chrome.tabs.sendMessage(this.tabId, {
            type: 'EXECUTE_DOM_ACTION',
            action: {
              type: action.type,
              selector: action.selector,
              fallbackSelectors: action.fallbackSelectors,
              ariaLabel: action.ariaLabel,
              textContent: action.textContent,
              value,
            },
          }) as { success: boolean; error?: string };
        } catch {
          result = await this.executeWithDebugger(step, value);
        }
      }
    }

    if (!result.success) {
      throw new Error(
        result.error ??
        `Step ${index + 1} failed: Could not interact with the page. The page layout may have changed.`
      );
    }

    // After a click, check if a new tab/popup appeared and switch to it
    if (action.type === 'click') {
      await this.checkAndSwitchToNewTab();
    }

    // Handle popup/window scenarios (explicit workflow metadata)
    if (step.opensPopup && step.popupActions) {
      await this.handlePopupActions(step.popupActions);
    }

    // Handle loop steps
    if (step.isLoopStep && step.loopCondition) {
      await this.handleLoopStep(step);
    }

    // Wait for any page transitions
    await this.waitForPageStable();
  }

  private async executeWithDebugger(
    step: WorkflowStep,
    value?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Attach debugger if not already attached
      if (this.debuggerTabId === null) {
        await chrome.debugger.attach({ tabId: this.tabId }, '1.3');
        this.debuggerTabId = this.tabId;
        await chrome.debugger.sendCommand({ tabId: this.tabId }, 'DOM.enable');
        await chrome.debugger.sendCommand({ tabId: this.tabId }, 'Runtime.enable');
      }

      const action = step.domAction;
      if (!action) return { success: false, error: 'No action to perform.' };

      // Use Runtime.evaluate to find and interact with element
      const script = buildDebuggerScript(action, value);
      const evalResult = await chrome.debugger.sendCommand(
        { tabId: this.tabId },
        'Runtime.evaluate',
        {
          expression: script,
          returnByValue: true,
          awaitPromise: false,
        }
      ) as { result?: { value?: { success: boolean; error?: string } } };

      if (evalResult?.result?.value) {
        return evalResult.result.value;
      }

      return { success: false, error: 'Could not execute the action through the browser.' };
    } catch (err) {
      return {
        success: false,
        error: `Could not reach the page. Make sure the tab is still open.`,
      };
    }
  }

  private async handlePopupActions(actions: WorkflowStep[]): Promise<void> {
    // Wait for new window/tab to appear
    const newTab = await this.waitForNewTab(5000);
    if (!newTab) return;

    // Execute actions in the popup
    for (const action of actions) {
      if (this.isStopped) break;
      if (!action.domAction) continue;

      try {
        await chrome.tabs.sendMessage(newTab.id!, {
          type: 'EXECUTE_DOM_ACTION',
          action: {
            type: action.domAction.type,
            selector: action.domAction.selector,
            fallbackSelectors: action.domAction.fallbackSelectors,
            ariaLabel: action.domAction.ariaLabel,
            textContent: action.domAction.textContent,
            value: action.domAction.value,
          },
        });
      } catch {
        // Popup may have closed
        break;
      }

      await this.sleep(500);
    }
  }

  private async waitForNewTab(timeout: number): Promise<chrome.tabs.Tab | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const listener = (tab: chrome.tabs.Tab) => {
        chrome.tabs.onCreated.removeListener(listener);
        // Give the tab a moment to load
        setTimeout(() => resolve(tab), 500);
      };

      chrome.tabs.onCreated.addListener(listener);

      // Timeout
      setTimeout(() => {
        chrome.tabs.onCreated.removeListener(listener);
        resolve(null);
      }, timeout);
    });
  }

  private async handleLoopStep(step: WorkflowStep): Promise<void> {
    if (!step.loopCondition) return;

    const maxIterations = 50;
    let iterations = 0;

    while (iterations < maxIterations && !this.isStopped) {
      const conditionMet = await this.checkLoopCondition(step.loopCondition);
      if (conditionMet) break;

      // Re-execute the step's DOM action
      if (step.domAction) {
        try {
          await chrome.tabs.sendMessage(this.tabId, {
            type: 'EXECUTE_DOM_ACTION',
            action: step.domAction,
          });
        } catch {
          break;
        }
      }

      await this.sleep(1000);
      iterations++;
    }
  }

  private async checkLoopCondition(condition: {
    type: string;
    selector?: string;
    jsonPath?: string;
    expectedValue?: string;
  }): Promise<boolean> {
    switch (condition.type) {
      case 'element_absent': {
        if (!condition.selector) return true;
        const found = await chrome.tabs.sendMessage(this.tabId, {
          type: 'FIND_ELEMENT',
          selector: condition.selector,
        }) as { found: boolean };
        return !found.found;
      }

      case 'element_present': {
        if (!condition.selector) return false;
        const found = await chrome.tabs.sendMessage(this.tabId, {
          type: 'FIND_ELEMENT',
          selector: condition.selector,
        }) as { found: boolean };
        return found.found;
      }

      case 'api_response_match': {
        // This would require monitoring network responses
        // For now, return true after checking
        return true;
      }

      default:
        return true;
    }
  }

  private async waitForPageStable(): Promise<void> {
    // Wait for the page to settle after an action
    await this.sleep(500);

    // Check if page is still loading
    try {
      const tab = await chrome.tabs.get(this.tabId);
      if (tab.status === 'loading') {
        // Wait up to 10 seconds for the page to finish loading
        let waited = 0;
        while (waited < 10000) {
          await this.sleep(300);
          waited += 300;
          const currentTab = await chrome.tabs.get(this.tabId);
          if (currentTab.status === 'complete') break;
        }
      }
    } catch {
      // Tab might have been closed
    }
  }

  // --- Tab monitoring for popup/OAuth windows ---

  private startTabMonitoring(): void {
    // Listen for new tabs created during playback
    this.tabCreatedListener = (tab: chrome.tabs.Tab) => {
      this.pendingNewTab = tab;
    };
    chrome.tabs.onCreated.addListener(this.tabCreatedListener);

    // Listen for tabs closing (popup done, switch back to original)
    this.tabRemovedListener = (removedTabId: number) => {
      if (removedTabId === this.tabId && this.tabId !== this.originalTabId) {
        // The popup tab we were working in just closed, switch back
        this.tabId = this.originalTabId;
      }
    };
    chrome.tabs.onRemoved.addListener(this.tabRemovedListener);
  }

  private stopTabMonitoring(): void {
    if (this.tabCreatedListener) {
      chrome.tabs.onCreated.removeListener(this.tabCreatedListener);
      this.tabCreatedListener = null;
    }
    if (this.tabRemovedListener) {
      chrome.tabs.onRemoved.removeListener(this.tabRemovedListener);
      this.tabRemovedListener = null;
    }
  }

  private async checkAndSwitchToNewTab(): Promise<void> {
    // Give a moment for the popup to appear
    await this.sleep(800);

    if (!this.pendingNewTab || !this.pendingNewTab.id) return;

    const newTabId = this.pendingNewTab.id;
    this.pendingNewTab = null;

    // Wait for the new tab to finish loading
    await this.waitForTabLoad(newTabId, 10000);

    // Inject content script into the new tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: newTabId },
        files: ['content-script.js'],
      });
    } catch {
      // May fail on restricted pages (chrome://, etc.)
      return;
    }

    // Give content script time to initialize
    await this.sleep(300);

    // Switch playback target to the new tab
    this.tabId = newTabId;
  }

  private async tryFindElementInOtherTabs(action: {
    selector: string;
    fallbackSelectors?: string[];
    ariaLabel?: string;
    textContent?: string;
  }): Promise<boolean> {
    // Get all tabs in the current window
    const tabs = await chrome.tabs.query({ currentWindow: true });

    for (const tab of tabs) {
      if (!tab.id || tab.id === this.tabId) continue;

      // Try to inject content script and find the element
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-script.js'],
        });
      } catch {
        continue; // Can't inject into this tab
      }

      await this.sleep(200);

      try {
        const found = await chrome.tabs.sendMessage(tab.id, {
          type: 'FIND_ELEMENT',
          selector: action.selector,
          fallbackSelectors: action.fallbackSelectors,
          ariaLabel: action.ariaLabel,
          textContent: action.textContent,
        }) as { found: boolean };

        if (found.found) {
          this.tabId = tab.id;
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async waitForTabLoad(tabId: number, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') return;
      } catch {
        return; // Tab may have closed
      }
      await this.sleep(300);
    }
  }

  pause(): void {
    this.isPaused = true;
    this.state.status = 'paused';
    this.broadcastState();
  }

  resume(): void {
    this.isPaused = false;
    this.state.status = 'running';
    this.broadcastState();
  }

  stop(): void {
    this.isStopped = true;
    this.state.status = 'idle';
    this.broadcastState();
    this.stopTabMonitoring();
    this.hideContentOverlay();
  }

  private broadcastState(): void {
    broadcastMessage({ type: 'PLAYBACK_UPDATE', state: this.getState() });
  }

  private updateContentOverlay(): void {
    const steps = this.workflow.definition?.steps ?? [];
    try {
      chrome.tabs.sendMessage(this.tabId, {
        type: 'SHOW_PLAYBACK_OVERLAY',
        steps: steps.map((s) => ({ description: s.description })),
        currentStep: this.state.currentStep,
        completedSteps: this.state.completedSteps,
      });
    } catch {
      // Content script not available
    }
  }

  private hideContentOverlay(): void {
    try {
      chrome.tabs.sendMessage(this.tabId, { type: 'HIDE_PLAYBACK_OVERLAY' });
    } catch {
      // Content script not available
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function buildDebuggerScript(
  action: { type: string; selector: string; value?: string },
  value?: string
): string {
  const escapedSelector = action.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const escapedValue = (value ?? action.value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  switch (action.type) {
    case 'click':
      return `(function() {
        var el = document.querySelector('${escapedSelector}');
        if (!el) return { success: false, error: 'Element not found on the page.' };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { success: true };
      })()`;

    case 'input':
      return `(function() {
        var el = document.querySelector('${escapedSelector}');
        if (!el) return { success: false, error: 'Input field not found on the page.' };
        el.scrollIntoView({ block: 'center' });
        el.focus();
        var nativeSetter = Object.getOwnPropertyDescriptor(
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        );
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, '${escapedValue}');
        } else {
          el.value = '${escapedValue}';
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      })()`;

    case 'submit':
      return `(function() {
        var el = document.querySelector('${escapedSelector}');
        if (!el) return { success: false, error: 'Form not found on the page.' };
        var form = el.tagName === 'FORM' ? el : el.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: 'Could not find the form to submit.' };
      })()`;

    default:
      return `(function() {
        var el = document.querySelector('${escapedSelector}');
        if (!el) return { success: false, error: 'Element not found.' };
        el.click();
        return { success: true };
      })()`;
  }
}

// --- Playback Start ---

async function startPlayback(params: PlaybackParams): Promise<void> {
  const workflow = await getWorkflow(params.workflowId);
  if (!workflow) {
    broadcastMessage({
      type: 'ERROR',
      message: 'Could not find the workflow. It may have been deleted.',
    });
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    broadcastMessage({
      type: 'ERROR',
      message: 'No active tab found. Please open the website first.',
    });
    return;
  }

  // Ensure content script is injected
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'FIND_ELEMENT', selector: 'body' });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js'],
      });
    } catch {
      broadcastMessage({
        type: 'ERROR',
        message: 'Could not connect to the page. Please reload the page and try again.',
      });
      return;
    }
  }

  // Try intelligent playback (Claude-powered) if engine is available with API key
  const engineUp = await isEngineAvailable();
  const apiKeyConfigured = engineUp ? await checkEngineApiKey() : false;

  if (engineUp && apiKeyConfigured && workflow.definition) {
    try {
      // Fetch workflow intent from Claude
      const intent = await fetchWorkflowIntent(workflow.definition, params.parameters);

      // Fetch past insights for learning
      const insights = await fetchPlaybackInsights(params.workflowId);

      // Use intelligent playback
      const controller = new IntelligentPlaybackController(
        workflow,
        params.parameters,
        tab.id,
        intent,
        insights
      );
      playbackController = controller as unknown as PlaybackController;
      playbackState = controller.getState();

      controller.start().catch((err) => {
        broadcastMessage({
          type: 'ERROR',
          message: err instanceof Error ? err.message : 'Intelligent playback failed.',
        });
      });
      return;
    } catch (err) {
      // Fall back to deterministic playback
      console.warn('Intelligent playback setup failed, falling back to deterministic:', err);
    }
  }

  // Fallback: deterministic playback
  playbackController = new PlaybackController(workflow, params.parameters, tab.id);
  playbackState = playbackController.getState();

  playbackController.start().catch((err) => {
    broadcastMessage({
      type: 'ERROR',
      message: err instanceof Error ? err.message : 'Playback failed unexpectedly.',
    });
  });
}

// --- Message Broadcasting ---

function broadcastMessage(message: Record<string, unknown>): void {
  // Send to popup (may not be open)
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup not open, ignore
  });
}

// --- Popup/Window Detection During Playback ---

chrome.windows.onCreated.addListener((window) => {
  if (playbackController && playbackState.status === 'running') {
    // A new window appeared during playback - this might be a popup
    // The PlaybackController handles this via waitForNewTab
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (playbackController && playbackState.status === 'running') {
    // A new tab appeared during playback
  }

  // During recording: inject content script into new tabs/popups so they
  // capture DOM events (e.g., SoundCloud Follow popup, Spotify auth popup)
  if (recordingState.isRecording && tab.id) {
    const tabId = tab.id;
    // Wait for the tab to finish loading before injecting
    const onUpdated = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-script.js'],
        }).then(() => {
          chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING_CONTENT' }).catch(() => {
            // Content script may not be ready yet, ignore
          });
        }).catch(() => {
          // Injection may fail on restricted pages, ignore
        });
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Clean up listener after 10s to avoid leaks
    setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdated), 10000);
  }
});

// --- Message Handler ---

chrome.runtime.onMessage.addListener(
  (
    message: Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    // Handle message asynchronously
    handleMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((err) => {
        sendResponse({
          type: 'ERROR',
          message: err instanceof Error ? err.message : 'Something went wrong.',
        });
      });

    return true; // Keep message channel open for async response
  }
);

async function handleMessage(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'START_RECORDING': {
      await startRecording(message.workflowName as string | undefined);
      return { success: true };
    }

    case 'STOP_RECORDING': {
      const session = await stopRecording();
      if (session) {
        // Process asynchronously (don't block the response)
        processRecordedSession(session).catch(console.error);
        return { success: true, sessionId: session.id };
      }
      return { success: false, error: 'No active recording.' };
    }

    case 'GET_RECORDING_STATUS': {
      return {
        isRecording: recordingState.isRecording,
        eventCount: recordingState.domEvents.length,
      };
    }

    case 'DOM_EVENT': {
      if (recordingState.isRecording) {
        const event = message.event as DOMEvent;
        event.windowId = sender.tab?.windowId;
        event.tabId = sender.tab?.id;
        recordingState.domEvents.push(event);

        // Broadcast event count update to popup
        broadcastMessage({
          type: 'RECORDING_STATUS',
          isRecording: true,
          eventCount: recordingState.domEvents.length,
        });
      }
      return { success: true };
    }

    case 'GET_WORKFLOWS': {
      const sitePattern = (message.sitePattern as string) ?? '';
      const workflows = await getWorkflowsForSite(sitePattern);
      return { type: 'WORKFLOWS_RESPONSE', workflows };
    }

    case 'RENAME_WORKFLOW': {
      const workflowId = message.workflowId as string;
      const name = message.name as string;
      const workflow = await getWorkflow(workflowId);
      if (workflow) {
        workflow.name = name;
        workflow.updatedAt = new Date().toISOString();
        if (workflow.definition) {
          workflow.definition.name = name;
        }
        await saveWorkflow(workflow);
      }
      return { success: true };
    }

    case 'START_PLAYBACK': {
      const params = message.params as PlaybackParams;
      await startPlayback(params);
      return { success: true };
    }

    case 'PAUSE_PLAYBACK': {
      playbackController?.pause();
      return { success: true };
    }

    case 'RESUME_PLAYBACK': {
      playbackController?.resume();
      return { success: true };
    }

    case 'STOP_PLAYBACK': {
      playbackController?.stop();
      playbackController = null;
      return { success: true };
    }

    case 'GET_PLAYBACK_STATUS': {
      return {
        state: playbackController?.getState() ?? {
          status: 'idle',
          currentStep: 0,
          totalSteps: 0,
          completedSteps: [],
        },
      };
    }

    case 'ANALYZE_WORKFLOW': {
      const wfId = message.workflowId as string;
      const wf = await getWorkflow(wfId);
      if (wf) {
        const engineUp = await isEngineAvailable();
        if (engineUp) {
          const analysis = await requestAnalysis(wfId, wf.sessions);
          if (analysis) {
            wf.definition = analysis.definition;
            wf.updatedAt = new Date().toISOString();
            await saveWorkflow(wf);
            return { type: 'ANALYSIS_COMPLETE', workflow: wf };
          }
        }
        return { type: 'ERROR', message: 'Analysis service is not available right now. Please try again later.' };
      }
      return { type: 'ERROR', message: 'Workflow not found.' };
    }

    default:
      return { error: `Unknown message: ${message.type}` };
  }
}

// --- Install/Update ---

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First install - clear any stale state
    chrome.storage.local.remove(['sessions', 'workflows']);
  }
});

// --- Keep Service Worker Alive During Recording ---

// The service worker may go to sleep. We use alarms to keep it alive during recording.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && recordingState.isRecording) {
    // Just touching the listener keeps the SW alive
    chrome.alarms.create('keepalive', { delayInMinutes: 0.4 });
  }
});

// Keepalive alarm is started within startRecording and cleared in stopRecording.
// The startRecording function already exists above; we just add alarm management.
// The alarm listener above handles the periodic ping.
