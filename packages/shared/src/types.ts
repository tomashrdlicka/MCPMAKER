// ============================================================
// MCPMAKER Shared Type Definitions
// From design doc: docs/design.md
// ============================================================

// --- Recording Types ---

export interface DOMEvent {
  timestamp: number;
  type: 'click' | 'input' | 'change' | 'submit' | 'navigate' | 'keydown';
  selector: string;
  elementContext: string;
  value?: string;
  screenshotRegion?: string; // base64 encoded small crop
  windowId?: number; // for multi-window/popup tracking
  tabId?: number;
  inputType?: string; // e.g., 'password', 'email', 'text'
  tagName?: string;
  attributes?: Record<string, string>;
  innerText?: string;
  ariaLabel?: string;
  formLabels?: string[];
  pageTitle?: string;
  pageUrl?: string;
}

export interface NetworkEvent {
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

export interface Correlation {
  domEventIndex: number;
  networkEventIndices: number[];
  timeGap: number;
}

export interface Session {
  id: string;
  workflowName: string;
  url: string;
  startedAt: number;
  endedAt: number;
  domEvents: DOMEvent[];
  networkEvents: NetworkEvent[];
  correlations: Correlation[];
}

// --- Workflow Definition Types ---

export interface StepInputMapping {
  sourceStep: number;
  sourceJsonPath: string;
  targetLocation: 'path' | 'query' | 'body' | 'header';
  targetKey: string;
  description: string;
}

export interface FieldExtraction {
  name: string;
  jsonPath: string;
  type: string;
  description: string;
}

export interface WorkflowStep {
  order: number;
  description: string;

  // DOM action for visual playback
  domAction?: {
    type: 'click' | 'input' | 'change' | 'submit' | 'navigate' | 'keydown';
    selector: string;
    fallbackSelectors: string[];
    ariaLabel?: string;
    textContent?: string;
    value?: string;
    parameterRef?: string; // references a ParameterDef.name for variable substitution
  };

  // API call for headless/MCP execution
  request: {
    method: string;
    pathTemplate: string;
    headers: Record<string, string>;
    bodyTemplate?: string;
    queryTemplate?: Record<string, string>;
  };

  inputMappings: StepInputMapping[];

  response: {
    expectedStatus: number;
    extractFields: FieldExtraction[];
  };

  dependsOn?: number;

  // For gate loop detection
  isLoopStep?: boolean;
  loopCondition?: {
    type: 'element_absent' | 'element_present' | 'api_response_match';
    selector?: string;
    jsonPath?: string;
    expectedValue?: string;
  };

  // For popup handling
  opensPopup?: boolean;
  popupActions?: WorkflowStep[];
}

export interface ParameterDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  example: string;
  usedIn: { step: number; location: 'path' | 'query' | 'body' | 'header'; key: string }[];
}

export interface ReturnDef {
  description: string;
  fields: {
    name: string;
    type: string;
    description: string;
    source: { step: number; jsonPath: string };
  }[];
}

export interface AuthPattern {
  type: 'cookie' | 'bearer' | 'api_key' | 'custom';
  credentialFields: {
    name: string;
    description: string;
    location: 'header' | 'cookie' | 'query';
  }[];
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  confidence: 'high' | 'medium' | 'low';

  steps: WorkflowStep[];
  parameters: ParameterDef[];
  returns: ReturnDef;

  auth: AuthPattern;
  baseUrl: string;

  recordingCount: number;
  lastRecorded: string;
}

// --- Workflow (User-facing entity) ---

export interface Workflow {
  id: string;
  name: string;
  sitePattern: string; // URL pattern to match (e.g., "hypeddit.com")
  sessions: string[]; // session IDs
  definition?: WorkflowDefinition;
  mcpServerPath?: string;
  mcpServerStatus?: 'stopped' | 'running' | 'error';
  createdAt: string;
  updatedAt: string;
}

// --- Engine API Types ---

export interface CreateSessionRequest {
  session: Session;
}

export interface CreateSessionResponse {
  id: string;
  workflowName: string;
}

export interface AnalyzeRequest {
  workflowId: string;
  sessionIds: string[];
}

export interface AnalyzeResponse {
  workflowId: string;
  definition: WorkflowDefinition;
  confidence: 'high' | 'medium' | 'low';
}

export interface DeployRequest {
  workflowId: string;
}

export interface DeployResponse {
  serverPath: string;
  status: 'running' | 'error';
  error?: string;
}

// --- Playback Types ---

export type PlaybackStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  currentStep: number;
  totalSteps: number;
  completedSteps: number[];
  error?: string;
  result?: Record<string, unknown>;
}

export interface PlaybackParams {
  workflowId: string;
  parameters: Record<string, string | number | boolean>;
}

// --- Extension Message Types ---

export type ExtensionMessage =
  | { type: 'START_RECORDING'; workflowName?: string }
  | { type: 'STOP_RECORDING' }
  | { type: 'RECORDING_STATUS'; isRecording: boolean; eventCount: number }
  | { type: 'START_PLAYBACK'; params: PlaybackParams }
  | { type: 'PAUSE_PLAYBACK' }
  | { type: 'RESUME_PLAYBACK' }
  | { type: 'STOP_PLAYBACK' }
  | { type: 'PLAYBACK_UPDATE'; state: PlaybackState }
  | { type: 'GET_WORKFLOWS'; sitePattern?: string }
  | { type: 'WORKFLOWS_RESPONSE'; workflows: Workflow[] }
  | { type: 'DOM_EVENT'; event: DOMEvent }
  | { type: 'NETWORK_EVENT'; event: NetworkEvent }
  | { type: 'SESSION_COMPLETE'; session: Session }
  | { type: 'ANALYZE_WORKFLOW'; workflowId: string }
  | { type: 'ANALYSIS_COMPLETE'; workflow: Workflow }
  | { type: 'ERROR'; message: string; details?: string };

// --- Constants ---

export const ENGINE_PORT = 7433;
export const ENGINE_BASE_URL = `http://localhost:${ENGINE_PORT}`;

export const TRACKING_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'hotjar.com',
  'fullstory.com',
  'mouseflow.com',
  'crazyegg.com',
  'optimizely.com',
  'amplitude.com',
  'heap.io',
  'heapanalytics.com',
  'intercom.io',
  'sentry.io',
  'bugsnag.com',
  'rollbar.com',
  'newrelic.com',
  'datadoghq.com',
  'facebook.net',
  'fbevents.com',
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googleadservices.com',
];

export const STATIC_CONTENT_TYPES = [
  'image/',
  'font/',
  'text/css',
  'application/javascript',
  'text/javascript',
  'application/x-javascript',
  'image/svg+xml',
  'application/font',
  'application/x-font',
];

export const STATIC_EXTENSIONS = [
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.ico',
  '.map',
];
