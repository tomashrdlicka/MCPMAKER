// ============================================================
// MCPMAKER Popup UI Controller
// Manages all popup views and user interactions
// ============================================================

// Ensure this file is treated as a module
export {};

// --- Inline Types (no imports from shared) ---

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

interface ParameterDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  example: string;
  usedIn: { step: number; location: string; key: string }[];
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

// --- View Management ---

type ViewName =
  | 'setup'
  | 'main'
  | 'recording'
  | 'learning'
  | 'created'
  | 'params'
  | 'playback'
  | 'complete'
  | 'error';

const views: Record<ViewName, HTMLElement> = {} as Record<ViewName, HTMLElement>;

function initViews(): void {
  const viewNames: ViewName[] = [
    'setup', 'main', 'recording', 'learning', 'created',
    'params', 'playback', 'complete', 'error',
  ];
  for (const name of viewNames) {
    const el = document.getElementById(`view-${name}`);
    if (el) {
      views[name] = el;
    }
  }
}

function showView(name: ViewName): void {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
  }
}

// --- State ---

let currentWorkflows: Workflow[] = [];
let activeWorkflowId: string | null = null;
let recordingEventCount = 0;
let playbackWorkflow: Workflow | null = null;

// --- Helpers ---

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function getSiteFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown site';
  }
}

function getSitePattern(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function sendMessage(message: Record<string, unknown>): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

async function getCurrentTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// --- Setup View ---

function initSetup(): void {
  const saveBtn = $('btn-save-key') as HTMLButtonElement;
  const keyInput = $('api-key-input') as HTMLInputElement;
  const keyError = $('key-error');

  saveBtn.addEventListener('click', async () => {
    const key = keyInput.value.trim();
    if (!key) {
      if (keyError) {
        keyError.textContent = 'Please enter your key.';
        keyError.hidden = false;
      }
      return;
    }
    if (!key.startsWith('sk-ant-')) {
      if (keyError) {
        keyError.textContent = 'That does not look like a valid key. It should start with "sk-ant-".';
        keyError.hidden = false;
      }
      return;
    }
    await chrome.storage.local.set({ anthropicApiKey: key });
    if (keyError) keyError.hidden = true;
    await loadMainView();
  });
}

// --- Main View ---

async function loadMainView(): Promise<void> {
  const tab = await getCurrentTab();
  const siteName = $('site-name');
  const url = tab?.url ?? '';
  if (siteName) {
    siteName.textContent = getSiteFromUrl(url);
  }

  const sitePattern = getSitePattern(url);

  // Fetch workflows for this site
  try {
    const response = await sendMessage({ type: 'GET_WORKFLOWS', sitePattern }) as {
      type: string;
      workflows: Workflow[];
    } | undefined;
    if (response && response.type === 'WORKFLOWS_RESPONSE') {
      currentWorkflows = response.workflows;
    } else {
      currentWorkflows = [];
    }
  } catch {
    currentWorkflows = [];
  }

  renderWorkflowsList();
  showView('main');
}

function renderWorkflowsList(): void {
  const list = $('workflows-list');
  const empty = $('no-workflows');
  if (!list) return;

  // Clear existing workflow items
  const existingItems = list.querySelectorAll('.workflow-item');
  existingItems.forEach((item) => item.remove());

  if (currentWorkflows.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  for (const wf of currentWorkflows) {
    const item = document.createElement('div');
    item.className = 'workflow-item';

    const stepCount = wf.definition?.steps.length ?? 0;
    const dateStr = new Date(wf.updatedAt).toLocaleDateString();

    item.innerHTML = `
      <div class="workflow-item-info">
        <div class="workflow-item-name">${escapeHtml(wf.name)}</div>
        <div class="workflow-item-meta">${stepCount} steps &middot; ${dateStr}</div>
      </div>
    `;

    const playBtn = document.createElement('button');
    playBtn.className = 'btn-play';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPlayWorkflow(wf);
    });

    item.appendChild(playBtn);
    list.appendChild(item);
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Recording ---

function initRecording(): void {
  const recordBtn = $('btn-record');
  const stopBtn = $('btn-stop-recording');

  recordBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'START_RECORDING' });
    recordingEventCount = 0;
    updateEventCount();
    showView('recording');
  });

  stopBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'STOP_RECORDING' });
    showView('learning');
    // The service worker will send SESSION_COMPLETE -> ANALYSIS_COMPLETE
  });
}

function updateEventCount(): void {
  const el = $('event-count');
  if (el) el.textContent = String(recordingEventCount);
}

// --- Learning / Created ---

function showWorkflowCreated(workflow: Workflow): void {
  const nameInput = $('workflow-name-input') as HTMLInputElement;
  const stepCountEl = $('step-count');
  if (nameInput) nameInput.value = workflow.name;
  if (stepCountEl) stepCountEl.textContent = String(workflow.definition?.steps.length ?? 0);
  activeWorkflowId = workflow.id;
  showView('created');
}

function initCreated(): void {
  const renameBtn = $('btn-rename');
  const recordAgainBtn = $('btn-record-again');
  const doneBtn = $('btn-done');
  const nameInput = $('workflow-name-input') as HTMLInputElement;

  renameBtn?.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (newName && activeWorkflowId) {
      await sendMessage({
        type: 'RENAME_WORKFLOW',
        workflowId: activeWorkflowId,
        name: newName,
      });
    }
  });

  recordAgainBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'START_RECORDING', workflowName: nameInput.value.trim() });
    recordingEventCount = 0;
    updateEventCount();
    showView('recording');
  });

  doneBtn?.addEventListener('click', async () => {
    await loadMainView();
  });
}

// --- Parameters ---

function onPlayWorkflow(workflow: Workflow): void {
  playbackWorkflow = workflow;

  const params = workflow.definition?.parameters ?? [];
  const requiredParams = params.filter((p) => p.required);

  if (requiredParams.length > 0) {
    renderParamsForm(requiredParams);
    showView('params');
  } else {
    startPlayback({});
  }
}

function renderParamsForm(params: ParameterDef[]): void {
  const form = $('params-form');
  if (!form) return;
  form.innerHTML = '';

  for (const param of params) {
    const field = document.createElement('div');
    field.className = 'param-field';

    const label = document.createElement('label');
    label.textContent = param.description || param.name;
    label.htmlFor = `param-${param.name}`;

    const input = document.createElement('input');
    input.type = param.type === 'number' ? 'number' : 'text';
    input.id = `param-${param.name}`;
    input.name = param.name;
    input.placeholder = param.example || '';
    if (param.required) input.required = true;

    const hint = document.createElement('p');
    hint.className = 'param-hint';
    hint.textContent = param.example ? `Example: ${param.example}` : '';

    field.appendChild(label);
    field.appendChild(input);
    if (param.example) field.appendChild(hint);
    form.appendChild(field);
  }
}

function initParams(): void {
  const cancelBtn = $('btn-cancel-params');
  const runBtn = $('btn-run-workflow');

  cancelBtn?.addEventListener('click', () => {
    showView('main');
  });

  runBtn?.addEventListener('click', () => {
    const form = $('params-form') as HTMLFormElement;
    if (!form) return;

    const inputs = form.querySelectorAll('input');
    const params: Record<string, string | number | boolean> = {};
    let valid = true;

    inputs.forEach((input) => {
      const val = input.value.trim();
      if (input.required && !val) {
        valid = false;
        input.style.borderColor = 'var(--color-danger)';
      } else {
        input.style.borderColor = '';
        if (input.type === 'number') {
          params[input.name] = Number(val);
        } else {
          params[input.name] = val;
        }
      }
    });

    if (valid) {
      startPlayback(params);
    }
  });
}

// --- Playback ---

async function startPlayback(params: Record<string, string | number | boolean>): Promise<void> {
  if (!playbackWorkflow) return;

  renderPlaybackSteps(playbackWorkflow.definition?.steps ?? []);
  showView('playback');

  await sendMessage({
    type: 'START_PLAYBACK',
    params: {
      workflowId: playbackWorkflow.id,
      parameters: params,
    },
  });
}

function renderPlaybackSteps(steps: WorkflowStep[]): void {
  const container = $('playback-steps');
  if (!container) return;
  container.innerHTML = '';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const el = document.createElement('div');
    el.className = 'playback-step';
    el.id = `playback-step-${i}`;
    el.innerHTML = `
      <span class="step-icon pending">${i + 1}</span>
      <span class="step-label">${escapeHtml(step.description)}</span>
    `;
    container.appendChild(el);
  }
}

function updatePlaybackStep(state: PlaybackState): void {
  const { currentStep, completedSteps, status, totalSteps } = state;

  for (let i = 0; i < totalSteps; i++) {
    const el = $(`playback-step-${i}`);
    if (!el) continue;

    const icon = el.querySelector('.step-icon');
    if (!icon) continue;

    el.className = 'playback-step';
    icon.className = 'step-icon';

    if (completedSteps.includes(i)) {
      el.classList.add('complete');
      icon.classList.add('complete');
      icon.innerHTML = '&#10003;'; // checkmark
    } else if (i === currentStep && status === 'running') {
      el.classList.add('active');
      icon.classList.add('active');
      icon.textContent = String(i + 1);
    } else if (i === currentStep && status === 'error') {
      el.classList.add('error');
      icon.classList.add('error');
      icon.innerHTML = '&#10007;'; // X mark
    } else {
      icon.classList.add('pending');
      icon.textContent = String(i + 1);
    }
  }
}

function initPlayback(): void {
  const pauseBtn = $('btn-pause') as HTMLButtonElement;
  const stopBtn = $('btn-stop-playback');

  pauseBtn?.addEventListener('click', async () => {
    if (pauseBtn.textContent === 'Pause') {
      await sendMessage({ type: 'PAUSE_PLAYBACK' });
      pauseBtn.textContent = 'Resume';
    } else {
      await sendMessage({ type: 'RESUME_PLAYBACK' });
      pauseBtn.textContent = 'Pause';
    }
  });

  stopBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'STOP_PLAYBACK' });
    await loadMainView();
  });
}

// --- Playback Complete ---

function showPlaybackComplete(state: PlaybackState): void {
  const summary = $('result-summary');
  if (!summary) return;

  if (state.result && Object.keys(state.result).length > 0) {
    let html = '';
    for (const [key, value] of Object.entries(state.result)) {
      html += `
        <div class="result-item">
          <span class="result-label">${escapeHtml(key)}</span>
          <span class="result-value">${escapeHtml(String(value))}</span>
        </div>
      `;
    }
    summary.innerHTML = html;
  } else {
    summary.innerHTML = '<p>All steps completed successfully.</p>';
  }

  showView('complete');
}

function initComplete(): void {
  const playAgainBtn = $('btn-play-again');
  const closeBtn = $('btn-close');

  playAgainBtn?.addEventListener('click', () => {
    if (playbackWorkflow) {
      onPlayWorkflow(playbackWorkflow);
    }
  });

  closeBtn?.addEventListener('click', async () => {
    await loadMainView();
  });
}

// --- Error ---

function showError(message: string): void {
  const el = $('error-message');
  if (el) el.textContent = message;
  showView('error');
}

function initError(): void {
  const retryBtn = $('btn-retry');
  const rerecordBtn = $('btn-rerecord');
  const cancelBtn = $('btn-cancel-error');

  retryBtn?.addEventListener('click', async () => {
    if (playbackWorkflow) {
      onPlayWorkflow(playbackWorkflow);
    } else {
      await loadMainView();
    }
  });

  rerecordBtn?.addEventListener('click', async () => {
    await sendMessage({ type: 'START_RECORDING' });
    recordingEventCount = 0;
    updateEventCount();
    showView('recording');
  });

  cancelBtn?.addEventListener('click', async () => {
    await loadMainView();
  });
}

// --- Settings ---

function initSettings(): void {
  const settingsBtn = $('btn-settings');
  settingsBtn?.addEventListener('click', () => {
    showView('setup');
    // Pre-fill the key input with masked value
    chrome.storage.local.get('anthropicApiKey', (data) => {
      const input = $('api-key-input') as HTMLInputElement;
      if (input && data.anthropicApiKey) {
        const key = data.anthropicApiKey as string;
        input.value = key;
        input.placeholder = key.slice(0, 10) + '...' + key.slice(-4);
      }
    });
  });
}

// --- Message Listener ---

function initMessageListener(): void {
  chrome.runtime.onMessage.addListener((message: Record<string, unknown>) => {
    switch (message.type) {
      case 'RECORDING_STATUS': {
        const isRecording = message.isRecording as boolean;
        const eventCount = message.eventCount as number;
        if (isRecording) {
          recordingEventCount = eventCount;
          updateEventCount();
        }
        break;
      }

      case 'PLAYBACK_UPDATE': {
        const state = message.state as PlaybackState;
        if (state.status === 'completed') {
          showPlaybackComplete(state);
        } else if (state.status === 'error') {
          updatePlaybackStep(state);
          setTimeout(() => {
            showError(state.error ?? 'Something went wrong while running your workflow. Please try again.');
          }, 1500);
        } else if (state.status === 'running' || state.status === 'paused') {
          updatePlaybackStep(state);
        }
        break;
      }

      case 'SESSION_COMPLETE': {
        // Session recorded, now in learning phase
        showView('learning');
        break;
      }

      case 'ANALYSIS_COMPLETE': {
        const workflow = message.workflow as Workflow;
        showWorkflowCreated(workflow);
        break;
      }

      case 'ERROR': {
        const errorMsg = message.message as string;
        showError(errorMsg);
        break;
      }
    }
  });
}

// --- Polling for recording status ---

let recordingPollInterval: ReturnType<typeof setInterval> | null = null;

function startRecordingPoll(): void {
  stopRecordingPoll();
  recordingPollInterval = setInterval(async () => {
    try {
      const response = await sendMessage({ type: 'GET_RECORDING_STATUS' }) as {
        isRecording: boolean;
        eventCount: number;
      } | undefined;
      if (response && response.isRecording) {
        recordingEventCount = response.eventCount;
        updateEventCount();
      }
    } catch {
      // Ignore errors during polling
    }
  }, 1000);
}

function stopRecordingPoll(): void {
  if (recordingPollInterval) {
    clearInterval(recordingPollInterval);
    recordingPollInterval = null;
  }
}

// --- Initialization ---

async function init(): Promise<void> {
  initViews();
  initSetup();
  initRecording();
  initCreated();
  initParams();
  initPlayback();
  initComplete();
  initError();
  initSettings();
  initMessageListener();

  // Check if we have an API key
  const data = await chrome.storage.local.get('anthropicApiKey');
  if (!data.anthropicApiKey) {
    showView('setup');
    return;
  }

  // Check if currently recording
  try {
    const status = await sendMessage({ type: 'GET_RECORDING_STATUS' }) as {
      isRecording: boolean;
      eventCount: number;
    } | undefined;
    if (status && status.isRecording) {
      recordingEventCount = status.eventCount;
      updateEventCount();
      showView('recording');
      startRecordingPoll();
      return;
    }
  } catch {
    // Service worker not ready, continue to main view
  }

  // Check if currently playing back
  try {
    const status = await sendMessage({ type: 'GET_PLAYBACK_STATUS' }) as {
      state: PlaybackState;
    } | undefined;
    if (status && status.state && status.state.status !== 'idle') {
      const state = status.state;
      if (state.status === 'completed') {
        showPlaybackComplete(state);
      } else if (state.status === 'error') {
        showError(state.error ?? 'Something went wrong.');
      } else {
        // Re-render the playback view
        showView('playback');
        updatePlaybackStep(state);
      }
      return;
    }
  } catch {
    // Service worker not ready, continue to main view
  }

  await loadMainView();
}

document.addEventListener('DOMContentLoaded', init);
