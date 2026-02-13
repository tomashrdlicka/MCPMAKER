// ============================================================
// MCPMAKER Engine - Stage 6: WorkflowDefinition Generation
// Assembles all analysis results into the final definition
// ============================================================

import type {
  Session,
  Correlation,
  NetworkEvent,
  DOMEvent,
  WorkflowDefinition,
  WorkflowStep,
  ParameterDef,
  AuthPattern,
  ReturnDef,
  FieldExtraction,
} from '../types.js';
import type { StepChain, ChainDetectionResult } from './chain-detector.js';
import { generateWorkflowMetadata } from './llm.js';

// ---- URL Template Generation ----

function buildPathTemplate(
  url: string,
  parameters: ParameterDef[],
  stepOrder: number
): string {
  try {
    const parsed = new URL(url);
    let pathTemplate = parsed.pathname;

    // Replace parameter values in the path with template placeholders
    for (const param of parameters) {
      for (const usage of param.usedIn) {
        if (usage.step === stepOrder && usage.location === 'path') {
          // Find the segment to replace
          if (param.example) {
            pathTemplate = pathTemplate.replace(param.example, `{${param.name}}`);
          }
        }
      }
    }

    return pathTemplate;
  } catch {
    return url;
  }
}

function buildQueryTemplate(
  url: string,
  parameters: ParameterDef[],
  stepOrder: number
): Record<string, string> | undefined {
  try {
    const parsed = new URL(url);
    const queryTemplate: Record<string, string> = {};
    let hasQuery = false;

    for (const [key, value] of parsed.searchParams.entries()) {
      hasQuery = true;

      // Check if this query param is a parameter
      const param = parameters.find((p) =>
        p.usedIn.some((u) => u.step === stepOrder && u.location === 'query' && u.key === key)
      );

      if (param) {
        queryTemplate[key] = `{${param.name}}`;
      } else {
        queryTemplate[key] = value;
      }
    }

    return hasQuery ? queryTemplate : undefined;
  } catch {
    return undefined;
  }
}

function buildBodyTemplate(
  body: string | undefined,
  parameters: ParameterDef[],
  stepOrder: number
): string | undefined {
  if (!body) return undefined;

  let template = body;

  for (const param of parameters) {
    for (const usage of param.usedIn) {
      if (usage.step === stepOrder && usage.location === 'body') {
        // Replace the example value with the parameter placeholder
        if (param.example) {
          // Handle JSON body - replace the value, keeping JSON structure
          template = template.replace(
            new RegExp(escapeRegex(param.example), 'g'),
            `{${param.name}}`
          );
        }
      }
    }
  }

  return template;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Header Cleaning ----

/**
 * Remove ephemeral/browser-specific headers, keep only relevant ones
 */
function cleanHeaders(headers: Record<string, string>): Record<string, string> {
  const skipHeaders = new Set([
    'content-length',
    'host',
    'connection',
    'user-agent',
    'accept-encoding',
    'accept-language',
    'origin',
    'referer',
    'sec-ch-ua',
    'sec-ch-ua-mobile',
    'sec-ch-ua-platform',
    'sec-fetch-dest',
    'sec-fetch-mode',
    'sec-fetch-site',
    'sec-fetch-user',
    'upgrade-insecure-requests',
    'cache-control',
    'pragma',
    'if-none-match',
    'if-modified-since',
  ]);

  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// ---- DOM Action Generation ----

function buildDomAction(
  domEvent: DOMEvent,
  parameters: ParameterDef[],
  stepOrder: number
): WorkflowStep['domAction'] {
  // Check if any parameter references this DOM event
  const paramRef = parameters.find((p) =>
    p.usedIn.some((u) => u.step === stepOrder)
  );

  return {
    type: domEvent.type,
    selector: domEvent.selector,
    fallbackSelectors: buildFallbackSelectors(domEvent),
    ariaLabel: domEvent.ariaLabel,
    textContent: domEvent.innerText?.substring(0, 100),
    value: domEvent.value,
    parameterRef: paramRef?.name,
  };
}

function buildFallbackSelectors(domEvent: DOMEvent): string[] {
  const fallbacks: string[] = [];

  // Try aria-label based selector
  if (domEvent.ariaLabel) {
    fallbacks.push(`[aria-label="${domEvent.ariaLabel}"]`);
  }

  // Try text-based selector if tag name is available
  if (domEvent.tagName && domEvent.innerText) {
    const text = domEvent.innerText.substring(0, 50);
    fallbacks.push(`${domEvent.tagName.toLowerCase()}:contains("${text}")`);
  }

  // Try attribute-based selectors
  if (domEvent.attributes) {
    if (domEvent.attributes['data-testid']) {
      fallbacks.push(`[data-testid="${domEvent.attributes['data-testid']}"]`);
    }
    if (domEvent.attributes['name']) {
      fallbacks.push(`[name="${domEvent.attributes['name']}"]`);
    }
    if (domEvent.attributes['id']) {
      fallbacks.push(`#${domEvent.attributes['id']}`);
    }
  }

  return fallbacks;
}

// ---- Response Field Extraction ----

function extractResponseFields(responseBody: string | undefined): FieldExtraction[] {
  if (!responseBody) return [];

  try {
    const parsed = JSON.parse(responseBody);
    return extractFieldsFromObject(parsed, '$');
  } catch {
    return [];
  }
}

function extractFieldsFromObject(obj: unknown, prefix: string, maxDepth = 3): FieldExtraction[] {
  if (maxDepth <= 0) return [];
  const fields: FieldExtraction[] = [];

  if (obj === null || obj === undefined) return fields;

  if (typeof obj !== 'object') {
    fields.push({
      name: prefix.split('.').pop() || prefix,
      jsonPath: prefix,
      type: typeof obj,
      description: `${prefix.split('.').pop()} value`,
    });
    return fields;
  }

  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      // Extract fields from first element as representative
      const itemFields = extractFieldsFromObject(obj[0], `${prefix}[0]`, maxDepth - 1);
      fields.push(...itemFields);
    }
    return fields;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = `${prefix}.${key}`;

    if (value !== null && typeof value === 'object') {
      fields.push(...extractFieldsFromObject(value, path, maxDepth - 1));
    } else {
      fields.push({
        name: key,
        jsonPath: path,
        type: typeof value || 'string',
        description: `${key} value`,
      });
    }
  }

  return fields;
}

// ---- Confidence Calculation ----

function calculateConfidence(
  recordingCount: number,
  chainValidation: boolean,
  parameterCount: number
): 'high' | 'medium' | 'low' {
  let score = 0;

  // More recordings = higher confidence
  if (recordingCount >= 3) score += 3;
  else if (recordingCount >= 2) score += 2;
  else score += 1;

  // Validated chains
  if (chainValidation) score += 2;

  // Parameters identified (means we had multi-session diffing)
  if (parameterCount > 0) score += 1;

  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

// ---- Full Definition Generation ----

export async function generateDefinition(
  workflowName: string,
  sessions: Session[],
  correlations: Correlation[][],
  coreNetworkIndices: number[][],
  parameters: ParameterDef[],
  chainResult: ChainDetectionResult,
  authPattern: AuthPattern
): Promise<WorkflowDefinition> {
  const refSession = sessions[0];
  const refCorrelations = correlations[0] || [];
  const refCoreIndices = coreNetworkIndices[0] || [];

  // Extract base URL
  let baseUrl = '';
  try {
    const firstUrl = refSession.networkEvents[0]?.url;
    if (firstUrl) {
      const parsed = new URL(firstUrl);
      baseUrl = `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    baseUrl = refSession.url;
  }

  // Build steps
  const steps: WorkflowStep[] = [];
  let stepOrder = 0;

  for (const corr of refCorrelations) {
    const domEvent = refSession.domEvents[corr.domEventIndex];

    for (const ni of corr.networkEventIndices) {
      if (!refCoreIndices.includes(ni)) continue;

      const networkEvent = refSession.networkEvents[ni];
      const currentOrder = stepOrder;

      // Build the step
      const pathTemplate = buildPathTemplate(networkEvent.url, parameters, currentOrder);
      const queryTemplate = buildQueryTemplate(networkEvent.url, parameters, currentOrder);
      const bodyTemplate = buildBodyTemplate(networkEvent.requestBody, parameters, currentOrder);
      const cleanedHeaders = cleanHeaders(networkEvent.requestHeaders);

      // Apply parameter placeholders to headers
      for (const param of parameters) {
        for (const usage of param.usedIn) {
          if (usage.step === currentOrder && usage.location === 'header') {
            if (cleanedHeaders[usage.key]) {
              cleanedHeaders[usage.key] = `{${param.name}}`;
            }
          }
        }
      }

      // Find chain dependencies
      const chain = chainResult.chains.find((c) => c.toStep === currentOrder);
      const dependsOn = chain ? chain.fromStep : undefined;

      // Get input mappings for this step
      const inputMappings = chainResult.chains
        .filter((c) => c.toStep === currentOrder)
        .flatMap((c) => c.inputMappings);

      // Extract response fields
      const extractFields = extractResponseFields(networkEvent.responseBody);

      // Check for loop/pagination
      const isLoopStep = chainResult.paginationSteps.includes(currentOrder);

      const step: WorkflowStep = {
        order: currentOrder,
        description: domEvent
          ? `${domEvent.type} on "${domEvent.elementContext}" triggering ${networkEvent.method} ${pathTemplate}`
          : `${networkEvent.method} ${pathTemplate}`,

        domAction: domEvent
          ? buildDomAction(domEvent, parameters, currentOrder)
          : undefined,

        request: {
          method: networkEvent.method,
          pathTemplate,
          headers: cleanedHeaders,
          bodyTemplate,
          queryTemplate,
        },

        inputMappings,

        response: {
          expectedStatus: networkEvent.responseStatus,
          extractFields,
        },

        dependsOn,
        isLoopStep,
      };

      steps.push(step);
      stepOrder++;
    }
  }

  // Generate metadata via LLM
  let description = `Workflow "${workflowName}" with ${steps.length} steps`;
  let returns: ReturnDef = {
    description: 'Workflow results',
    fields: [],
  };

  try {
    const stepSummaries = steps.map((s) => ({
      order: s.order,
      method: s.request.method,
      url: `${baseUrl}${s.request.pathTemplate}`,
      description: s.description,
    }));

    const paramSummaries = parameters.map((p) => ({
      name: p.name,
      type: p.type,
      description: p.description,
    }));

    const metadata = await generateWorkflowMetadata(
      workflowName,
      stepSummaries,
      paramSummaries,
      baseUrl
    );

    description = metadata.description;

    // Build return definition from LLM output
    returns = {
      description: metadata.returnDescription,
      fields: metadata.returnFields.map((rf) => ({
        name: rf.name,
        type: rf.type,
        description: rf.description,
        source: { step: rf.sourceStep, jsonPath: rf.sourceJsonPath },
      })),
    };
  } catch (error) {
    console.warn('LLM metadata generation failed, using defaults:', (error as Error).message);

    // Use the last step's response fields as the return
    const lastStep = steps[steps.length - 1];
    if (lastStep) {
      returns = {
        description: `Results from ${workflowName}`,
        fields: lastStep.response.extractFields.slice(0, 10).map((ef) => ({
          name: ef.name,
          type: ef.type,
          description: ef.description,
          source: { step: lastStep.order, jsonPath: ef.jsonPath },
        })),
      };
    }
  }

  // Calculate confidence
  const confidence = calculateConfidence(
    sessions.length,
    chainResult.chains.length > 0,
    parameters.length
  );

  const definition: WorkflowDefinition = {
    name: workflowName,
    description,
    confidence,
    steps,
    parameters,
    returns,
    auth: authPattern,
    baseUrl,
    recordingCount: sessions.length,
    lastRecorded: new Date(
      Math.max(...sessions.map((s) => s.endedAt))
    ).toISOString(),
  };

  return definition;
}
