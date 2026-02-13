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

  // Try to send to engine for analysis
  const engineUp = await isEngineAvailable();
  let workflow: Workflow;

  if (engineUp) {
    // Send to engine
    const engineResult = await sendSessionToEngine(session);

    if (engineResult) {
      // Request analysis
      const analysis = await requestAnalysis(engineResult.id, [session.id]);

      if (analysis) {
        workflow = {
          id: engineResult.id,
          name: analysis.definition.name,
          sitePattern: new URL(session.url).hostname,
          sessions: [session.id],
          definition: analysis.definition,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else {
        // Engine analysis failed, use local fallback
        workflow = createLocalWorkflow(session);
      }
    } else {
      workflow = createLocalWorkflow(session);
    }
  } else {
    // Engine not available, use local fallback
    workflow = createLocalWorkflow(session);
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

// --- Playback Controller ---

class PlaybackController {
  private workflow: Workflow;
  private params: Record<string, string | number | boolean>;
  private state: PlaybackState;
  private isPaused = false;
  private isStopped = false;
  private debuggerTabId: number | null = null;
  private tabId: number;

  constructor(
    workflow: Workflow,
    params: Record<string, string | number | boolean>,
    tabId: number
  ) {
    this.workflow = workflow;
    this.params = params;
    this.tabId = tabId;
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

    // Clean up overlay
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

    // Highlight the element first
    try {
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'HIGHLIGHT_ELEMENT',
        selector: action.selector,
        duration: 600,
      });
    } catch {
      // Content script not available
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
      // Try using debugger as fallback
      result = await this.executeWithDebugger(step, value);
    }

    if (!result.success) {
      throw new Error(
        result.error ??
        `Step ${index + 1} failed: Could not interact with the page. The page layout may have changed.`
      );
    }

    // Handle popup/window scenarios
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

  playbackController = new PlaybackController(workflow, params.parameters, tab.id);
  playbackState = playbackController.getState();

  // Start playback asynchronously
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
