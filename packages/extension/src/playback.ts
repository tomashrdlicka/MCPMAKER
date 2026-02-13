// ============================================================
// MCPMAKER Playback Engine
// CDP-based browser automation with multi-strategy element location
// ============================================================

// --- Inline Types ---

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
  dependsOn?: number;
  isLoopStep?: boolean;
  loopCondition?: {
    type: 'element_absent' | 'element_present' | 'api_response_match';
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

interface PlaybackCallbacks {
  onStateChange: (state: PlaybackState) => void;
  onStepStart: (stepIndex: number, step: WorkflowStep) => void;
  onStepComplete: (stepIndex: number) => void;
  onError: (stepIndex: number, error: string) => void;
}

// --- Playback Engine ---

export class PlaybackEngine {
  private workflow: Workflow;
  private params: Record<string, string | number | boolean>;
  private tabId: number;
  private callbacks: PlaybackCallbacks;
  private state: PlaybackState;
  private debuggerAttached = false;
  private popupTabIds: number[] = [];
  private isPaused = false;
  private boundDebuggerHandler: ((source: chrome.debugger.Debuggee, method: string, params?: object) => void) | null = null;
  private isStopped = false;
  private networkLog: Array<{
    url: string;
    method: string;
    status?: number;
    timestamp: number;
  }> = [];
  private downloadEvents: Array<{
    url: string;
    suggestedFilename: string;
    timestamp: number;
  }> = [];

  constructor(
    workflow: Workflow,
    params: Record<string, string | number | boolean>,
    tabId: number,
    callbacks: PlaybackCallbacks
  ) {
    this.workflow = workflow;
    this.params = params;
    this.tabId = tabId;
    this.callbacks = callbacks;

    const totalSteps = workflow.definition?.steps.length ?? 0;
    this.state = {
      status: 'idle',
      currentStep: 0,
      totalSteps,
      completedSteps: [],
    };
  }

  getState(): PlaybackState {
    return { ...this.state };
  }

  // --- Main execution ---

  async execute(): Promise<PlaybackState> {
    const steps = this.workflow.definition?.steps ?? [];
    if (steps.length === 0) {
      return this.setError('This workflow has no steps to run.');
    }

    this.updateState({ status: 'starting' });

    // Attach debugger for CDP access
    try {
      await this.attachDebugger(this.tabId);
    } catch {
      // Debugger attachment failed, we can still try content-script-based execution
    }

    // Enable network monitoring via CDP
    if (this.debuggerAttached) {
      try {
        await this.cdpCommand('Network.enable');
        await this.cdpCommand('Page.enable');

        // Listen for download events
        this.boundDebuggerHandler = ((source: chrome.debugger.Debuggee, method: string, params?: object) => {
          this.onDebuggerEvent(source, method, params as Record<string, unknown> | undefined);
        });
        chrome.debugger.onEvent.addListener(this.boundDebuggerHandler);
      } catch {
        // Non-critical failure
      }
    }

    this.updateState({ status: 'running' });

    // Set up popup/window listeners
    const tabListener = this.onTabCreated.bind(this);
    chrome.tabs.onCreated.addListener(tabListener);

    try {
      for (let i = 0; i < steps.length; i++) {
        if (this.isStopped) break;

        // Wait while paused
        await this.waitWhilePaused();
        if (this.isStopped) break;

        this.updateState({ currentStep: i });
        this.callbacks.onStepStart(i, steps[i]);

        try {
          await this.executeStep(steps[i], i);
        } catch (err) {
          const errorMsg =
            err instanceof Error
              ? err.message
              : 'Something went wrong on this step.';

          this.callbacks.onError(i, errorMsg);
          return this.setError(errorMsg);
        }

        this.state.completedSteps.push(i);
        this.callbacks.onStepComplete(i);
        this.updateState({});

        // Brief visual pause
        await this.sleep(250);
      }

      if (!this.isStopped) {
        const result = this.buildResult();
        this.updateState({ status: 'completed', result });
      }
    } finally {
      // Cleanup
      chrome.tabs.onCreated.removeListener(tabListener);
      await this.cleanup();
    }

    return this.getState();
  }

  // --- Step Execution ---

  private async executeStep(step: WorkflowStep, index: number): Promise<void> {
    // Handle navigate action
    if (step.domAction?.type === 'navigate' && step.domAction.value) {
      await this.navigateToUrl(step.domAction.value);
      return;
    }

    // Execute DOM action if present
    if (step.domAction) {
      await this.executeDomAction(step, index);
    }

    // Handle popup actions
    if (step.opensPopup && step.popupActions && step.popupActions.length > 0) {
      await this.executePopupActions(step.popupActions);
    }

    // Handle gate loops
    if (step.isLoopStep && step.loopCondition) {
      await this.executeGateLoop(step);
    }

    // Wait for page to stabilize
    await this.waitForStable();

    // Validate network call if step has a request defined
    if (step.request?.pathTemplate) {
      await this.validateNetworkCall(step, index);
    }
  }

  private async executeDomAction(step: WorkflowStep, index: number): Promise<void> {
    const action = step.domAction!;

    // Substitute parameters
    let value = action.value;
    if (action.parameterRef && this.params[action.parameterRef] !== undefined) {
      value = String(this.params[action.parameterRef]);
    }

    // Highlight element before acting
    await this.highlightElement(action.selector);
    await this.sleep(300);

    // Try content script execution first (more reliable for standard actions)
    const csResult = await this.executeViaContentScript(action, value);
    if (csResult.success) return;

    // Fallback to CDP
    if (this.debuggerAttached) {
      const cdpResult = await this.executeViaCdp(action, value);
      if (cdpResult.success) return;
    }

    // All strategies failed
    throw new Error(
      csResult.error ??
      `Could not find or interact with the element for step ${index + 1}. ` +
      `The page may look different than when the workflow was recorded.`
    );
  }

  // --- Element Location Strategies ---

  private async executeViaContentScript(
    action: { type: string; selector: string; fallbackSelectors?: string[]; ariaLabel?: string; textContent?: string; value?: string },
    value?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await chrome.tabs.sendMessage(this.tabId, {
        type: 'EXECUTE_DOM_ACTION',
        action: {
          type: action.type,
          selector: action.selector,
          fallbackSelectors: action.fallbackSelectors ?? [],
          ariaLabel: action.ariaLabel,
          textContent: action.textContent,
          value,
        },
      }) as { success: boolean; error?: string };
    } catch {
      return { success: false, error: 'Could not communicate with the page.' };
    }
  }

  private async executeViaCdp(
    action: { type: string; selector: string; value?: string },
    value?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Find the element using CDP DOM.querySelector
      const docResult = await this.cdpCommand('DOM.getDocument', { depth: 0 });
      const rootNodeId = (docResult as { root: { nodeId: number } }).root.nodeId;

      let nodeId: number;
      try {
        const queryResult = await this.cdpCommand('DOM.querySelector', {
          nodeId: rootNodeId,
          selector: action.selector,
        });
        nodeId = (queryResult as { nodeId: number }).nodeId;
      } catch {
        return { success: false, error: 'Element not found via CDP.' };
      }

      if (!nodeId || nodeId === 0) {
        return { success: false, error: 'Element not found on the page.' };
      }

      // Get the element's bounding box for click events
      const boxResult = await this.cdpCommand('DOM.getBoxModel', { nodeId });
      const content = (boxResult as { model: { content: number[] } }).model.content;
      const x = (content[0] + content[2]) / 2;
      const y = (content[1] + content[5]) / 2;

      switch (action.type) {
        case 'click': {
          // Scroll to element first
          await this.cdpCommand('DOM.scrollIntoViewIfNeeded', { nodeId });
          await this.sleep(100);

          // Simulate mouse click via CDP
          await this.cdpCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1,
          });
          await this.cdpCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1,
          });
          return { success: true };
        }

        case 'input': {
          // Focus the element
          await this.cdpCommand('DOM.focus', { nodeId });
          await this.sleep(50);

          // Clear existing value
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'a',
            code: 'KeyA',
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
            modifiers: 2, // Ctrl
          });
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'a',
            code: 'KeyA',
            windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65,
            modifiers: 2,
          });

          // Type the new value
          const text = value ?? action.value ?? '';
          await this.cdpCommand('Input.insertText', { text });
          return { success: true };
        }

        case 'submit': {
          // Press Enter
          await this.cdpCommand('DOM.focus', { nodeId });
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key: 'Enter',
            code: 'Enter',
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
          return { success: true };
        }

        case 'keydown': {
          const key = value ?? action.value ?? 'Enter';
          await this.cdpCommand('DOM.focus', { nodeId });
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyDown',
            key,
            text: key.length === 1 ? key : '',
          });
          await this.cdpCommand('Input.dispatchKeyEvent', {
            type: 'keyUp',
            key,
            text: key.length === 1 ? key : '',
          });
          return { success: true };
        }

        default:
          return { success: false, error: `Unsupported action type: ${action.type}` };
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'CDP execution failed.',
      };
    }
  }

  // --- Navigation ---

  private async navigateToUrl(url: string): Promise<void> {
    if (this.debuggerAttached) {
      await this.cdpCommand('Page.navigate', { url });
    } else {
      await chrome.tabs.update(this.tabId, { url });
    }
    await this.waitForLoad();
  }

  // --- Popup Handling ---

  private onTabCreated(tab: chrome.tabs.Tab): void {
    if (tab.id) {
      this.popupTabIds.push(tab.id);
    }
  }

  private async executePopupActions(actions: WorkflowStep[]): Promise<void> {
    // Wait for a popup tab to appear
    const popupTabId = await this.waitForPopupTab(5000);
    if (!popupTabId) return;

    // Wait for popup to load
    await this.sleep(1000);

    // Inject content script into popup
    try {
      await chrome.scripting.executeScript({
        target: { tabId: popupTabId },
        files: ['content-script.js'],
      });
    } catch {
      // May already be injected
    }

    // Execute each action in the popup
    for (const action of actions) {
      if (this.isStopped) break;
      if (!action.domAction) continue;

      let value = action.domAction.value;
      if (action.domAction.parameterRef && this.params[action.domAction.parameterRef] !== undefined) {
        value = String(this.params[action.domAction.parameterRef]);
      }

      try {
        await chrome.tabs.sendMessage(popupTabId, {
          type: 'EXECUTE_DOM_ACTION',
          action: {
            type: action.domAction.type,
            selector: action.domAction.selector,
            fallbackSelectors: action.domAction.fallbackSelectors,
            ariaLabel: action.domAction.ariaLabel,
            textContent: action.domAction.textContent,
            value,
          },
        });
      } catch {
        // Popup may have closed
        break;
      }

      await this.sleep(500);
    }
  }

  private async waitForPopupTab(timeout: number): Promise<number | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.popupTabIds.length > 0) {
        return this.popupTabIds[this.popupTabIds.length - 1];
      }
      await this.sleep(200);
    }
    return null;
  }

  // --- Gate Loop ---

  private async executeGateLoop(step: WorkflowStep): Promise<void> {
    const condition = step.loopCondition!;
    const maxIterations = 50;
    let iterations = 0;

    while (iterations < maxIterations && !this.isStopped) {
      const met = await this.evaluateCondition(condition);
      if (met) return;

      // Re-execute the step action
      if (step.domAction) {
        const value = step.domAction.parameterRef
          ? String(this.params[step.domAction.parameterRef] ?? step.domAction.value ?? '')
          : step.domAction.value;

        await this.executeViaContentScript(step.domAction, value);
      }

      await this.sleep(1000);
      iterations++;
    }

    if (iterations >= maxIterations) {
      throw new Error(
        'This step waited too long for the expected result. ' +
        'The page may not be responding as expected.'
      );
    }
  }

  private async evaluateCondition(condition: {
    type: string;
    selector?: string;
    jsonPath?: string;
    expectedValue?: string;
  }): Promise<boolean> {
    switch (condition.type) {
      case 'element_absent': {
        if (!condition.selector) return true;
        try {
          const result = await chrome.tabs.sendMessage(this.tabId, {
            type: 'FIND_ELEMENT',
            selector: condition.selector,
          }) as { found: boolean };
          return !result.found;
        } catch {
          return true;
        }
      }

      case 'element_present': {
        if (!condition.selector) return false;
        try {
          const result = await chrome.tabs.sendMessage(this.tabId, {
            type: 'FIND_ELEMENT',
            selector: condition.selector,
          }) as { found: boolean };
          return result.found;
        } catch {
          return false;
        }
      }

      case 'api_response_match': {
        // Check recent network events for matching response
        if (condition.expectedValue) {
          const recent = this.networkLog.filter(
            (n) => Date.now() - n.timestamp < 5000
          );
          return recent.some(
            (n) => n.status !== undefined && String(n.status) === condition.expectedValue
          );
        }
        return true;
      }

      default:
        return true;
    }
  }

  // --- Network Validation ---

  private async validateNetworkCall(step: WorkflowStep, index: number): Promise<void> {
    // This is a soft validation - we check if a matching network call happened
    // but don't fail the step if it didn't (the action may have succeeded visually)
    if (!step.request?.pathTemplate) return;

    const matchingCalls = this.networkLog.filter((n) => {
      if (step.request.method && n.method !== step.request.method) return false;
      if (step.request.pathTemplate && !n.url.includes(step.request.pathTemplate)) return false;
      return true;
    });

    // We just log this - no failure for missing network calls
    // as the UI action may have been the important part
  }

  // --- Download Detection ---

  private onDebuggerEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params?: Record<string, unknown>
  ): void {
    if (source.tabId !== this.tabId) return;

    if (method === 'Page.downloadWillBegin' && params) {
      this.downloadEvents.push({
        url: params.url as string,
        suggestedFilename: params.suggestedFilename as string,
        timestamp: Date.now(),
      });
    }

    if (method === 'Network.responseReceived' && params) {
      const response = params.response as { url: string; status: number };
      this.networkLog.push({
        url: response.url,
        method: (params.type as string) ?? 'GET',
        status: response.status,
        timestamp: Date.now(),
      });
    }
  }

  // --- CDP Helpers ---

  private async attachDebugger(tabId: number): Promise<void> {
    await chrome.debugger.attach({ tabId }, '1.3');
    this.debuggerAttached = true;
  }

  private async cdpCommand(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params);
  }

  private async highlightElement(selector: string): Promise<void> {
    try {
      await chrome.tabs.sendMessage(this.tabId, {
        type: 'HIGHLIGHT_ELEMENT',
        selector,
        duration: 500,
      });
    } catch {
      // Content script not reachable
    }
  }

  // --- Waiting Utilities ---

  private async waitForLoad(): Promise<void> {
    let waited = 0;
    const maxWait = 15000;
    while (waited < maxWait) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (tab.status === 'complete') return;
      } catch {
        return;
      }
      await this.sleep(300);
      waited += 300;
    }
  }

  private async waitForStable(): Promise<void> {
    await this.sleep(400);
    try {
      const tab = await chrome.tabs.get(this.tabId);
      if (tab.status === 'loading') {
        await this.waitForLoad();
      }
    } catch {
      // Tab may have been closed
    }
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.isPaused && !this.isStopped) {
      await this.sleep(200);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // --- State Management ---

  private updateState(partial: Partial<PlaybackState>): void {
    Object.assign(this.state, partial);
    this.callbacks.onStateChange(this.getState());
  }

  private setError(message: string): PlaybackState {
    this.state.status = 'error';
    this.state.error = message;
    this.callbacks.onStateChange(this.getState());
    return this.getState();
  }

  private buildResult(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      stepsCompleted: this.state.completedSteps.length,
      totalSteps: this.state.totalSteps,
    };

    if (this.downloadEvents.length > 0) {
      result.downloads = this.downloadEvents.map((d) => d.suggestedFilename);
    }

    return result;
  }

  // --- Controls ---

  pause(): void {
    this.isPaused = true;
    this.updateState({ status: 'paused' });
  }

  resume(): void {
    this.isPaused = false;
    this.updateState({ status: 'running' });
  }

  stop(): void {
    this.isStopped = true;
    this.updateState({ status: 'idle' });
  }

  // --- Cleanup ---

  private async cleanup(): Promise<void> {
    // Detach debugger
    if (this.debuggerAttached) {
      try {
        if (this.boundDebuggerHandler) {
          chrome.debugger.onEvent.removeListener(this.boundDebuggerHandler);
          this.boundDebuggerHandler = null;
        }
        await chrome.debugger.detach({ tabId: this.tabId });
      } catch {
        // Already detached
      }
      this.debuggerAttached = false;
    }

    // Hide overlay
    try {
      await chrome.tabs.sendMessage(this.tabId, { type: 'HIDE_PLAYBACK_OVERLAY' });
    } catch {
      // Content script not reachable
    }
  }
}

// --- Error Message Translations ---
// Map technical errors to plain English

export function translateError(error: string): string {
  const translations: Array<[RegExp, string]> = [
    [
      /cannot attach/i,
      'Could not connect to the browser tab. Please try closing other developer tools and try again.',
    ],
    [
      /target closed/i,
      'The tab was closed while running. Please keep the tab open and try again.',
    ],
    [
      /no tab/i,
      'Could not find the browser tab. Please open the website and try again.',
    ],
    [
      /timeout/i,
      'The page took too long to respond. Please check your internet connection and try again.',
    ],
    [
      /not found/i,
      'Could not find what we were looking for on the page. The website may have changed since this workflow was recorded.',
    ],
    [
      /permission/i,
      'We do not have permission to interact with this page. Some browser pages are restricted.',
    ],
    [
      /detached/i,
      'Lost connection to the page. Please try again.',
    ],
    [
      /navigate/i,
      'Could not open the page. Please check that the website is accessible.',
    ],
  ];

  for (const [pattern, translation] of translations) {
    if (pattern.test(error)) {
      return translation;
    }
  }

  // If no translation matches, return a generic message
  return 'Something unexpected happened. Please try again, or re-record the workflow if the problem continues.';
}
