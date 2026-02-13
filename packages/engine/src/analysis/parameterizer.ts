// ============================================================
// MCPMAKER Engine - Stage 3: Parameterization
// Identifies variable parts across recordings and names them
// ============================================================

import type {
  NetworkEvent,
  DOMEvent,
  Session,
  ParameterDef,
  Correlation,
} from '../types.js';
import { parameterizeWorkflow } from './llm.js';

interface StepCandidate {
  /** Step order (0-based) */
  order: number;
  /** Network events from each session for this step */
  sessionEvents: Array<{
    networkEvent: NetworkEvent;
    domEvent: DOMEvent | null;
  }>;
}

interface VaryingPart {
  location: 'path' | 'query' | 'body' | 'header';
  key: string;
  values: string[];
}

// ---- URL Path Diffing ----

function extractPathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

function diffPathSegments(urlSets: string[][]): Array<{ segmentIndex: number; values: string[] }> {
  if (urlSets.length < 2) return [];

  const maxLen = Math.max(...urlSets.map((s) => s.length));
  const varying: Array<{ segmentIndex: number; values: string[] }> = [];

  for (let i = 0; i < maxLen; i++) {
    const valuesAtPosition = urlSets.map((segments) => segments[i] || '');
    const uniqueValues = new Set(valuesAtPosition);

    if (uniqueValues.size > 1) {
      varying.push({
        segmentIndex: i,
        values: [...uniqueValues],
      });
    }
  }

  return varying;
}

// ---- Query Parameter Diffing ----

function extractQueryParams(url: string): Record<string, string> {
  try {
    const params: Record<string, string> = {};
    new URL(url).searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

function diffQueryParams(paramSets: Record<string, string>[]): Array<{ key: string; values: string[] }> {
  if (paramSets.length < 2) return [];

  // Collect all keys
  const allKeys = new Set<string>();
  for (const params of paramSets) {
    Object.keys(params).forEach((k) => allKeys.add(k));
  }

  const varying: Array<{ key: string; values: string[] }> = [];

  for (const key of allKeys) {
    const valuesForKey = paramSets.map((p) => p[key] || '');
    const uniqueValues = new Set(valuesForKey);

    if (uniqueValues.size > 1) {
      varying.push({
        key,
        values: [...uniqueValues].filter(Boolean),
      });
    }
  }

  return varying;
}

// ---- Body Diffing ----

function parseBodySafe(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = String(value);
    }
  }

  return result;
}

function diffBodies(bodies: Array<Record<string, unknown> | null>): Array<{ key: string; values: string[] }> {
  const validBodies = bodies.filter((b): b is Record<string, unknown> => b !== null);
  if (validBodies.length < 2) return [];

  const flatBodies = validBodies.map((b) => flattenObject(b));

  // Collect all keys
  const allKeys = new Set<string>();
  for (const flat of flatBodies) {
    Object.keys(flat).forEach((k) => allKeys.add(k));
  }

  const varying: Array<{ key: string; values: string[] }> = [];

  for (const key of allKeys) {
    const valuesForKey = flatBodies.map((f) => f[key] || '');
    const uniqueValues = new Set(valuesForKey);

    if (uniqueValues.size > 1) {
      varying.push({
        key,
        values: [...uniqueValues].filter(Boolean),
      });
    }
  }

  return varying;
}

// ---- Header Diffing ----

// Headers that commonly vary and aren't user parameters
const IGNORE_HEADERS = new Set([
  'content-length',
  'date',
  'x-request-id',
  'x-trace-id',
  'x-correlation-id',
  'etag',
  'last-modified',
  'if-none-match',
  'if-modified-since',
  'accept',
  'accept-encoding',
  'accept-language',
  'user-agent',
  'referer',
  'origin',
  'host',
  'connection',
  'cache-control',
  'pragma',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
]);

function diffHeaders(headerSets: Record<string, string>[]): Array<{ key: string; values: string[] }> {
  if (headerSets.length < 2) return [];

  const allKeys = new Set<string>();
  for (const headers of headerSets) {
    Object.keys(headers).forEach((k) => allKeys.add(k.toLowerCase()));
  }

  const varying: Array<{ key: string; values: string[] }> = [];

  for (const key of allKeys) {
    if (IGNORE_HEADERS.has(key)) continue;

    const valuesForKey = headerSets.map((h) => {
      // Case-insensitive lookup
      const matchedKey = Object.keys(h).find((k) => k.toLowerCase() === key);
      return matchedKey ? h[matchedKey] : '';
    });
    const uniqueValues = new Set(valuesForKey);

    if (uniqueValues.size > 1) {
      varying.push({
        key,
        values: [...uniqueValues].filter(Boolean),
      });
    }
  }

  return varying;
}

// ---- Step Matching Across Sessions ----

/**
 * Match network events across sessions to identify the "same" step.
 * Uses method + URL pattern (ignoring variable parts) as the matching key.
 */
function normalizeUrlForMatching(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove query params for matching
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function matchStepsAcrossSessions(
  sessions: Session[],
  correlations: Correlation[][]
): StepCandidate[] {
  if (sessions.length === 0) return [];

  // Use the first session as the reference for step ordering
  const referenceSession = sessions[0];
  const refCorrelations = correlations[0] || [];

  const steps: StepCandidate[] = [];

  for (const refCorr of refCorrelations) {
    // Get the primary network event for this correlation
    if (refCorr.networkEventIndices.length === 0) continue;

    const refNetworkIdx = refCorr.networkEventIndices[0];
    const refNetworkEvent = referenceSession.networkEvents[refNetworkIdx];
    const refDomEvent = referenceSession.domEvents[refCorr.domEventIndex];
    const refNormUrl = normalizeUrlForMatching(refNetworkEvent.url);
    const refMethod = refNetworkEvent.method;

    const sessionEvents: StepCandidate['sessionEvents'] = [
      { networkEvent: refNetworkEvent, domEvent: refDomEvent },
    ];

    // Find matching events in other sessions
    for (let si = 1; si < sessions.length; si++) {
      const session = sessions[si];
      const sessionCorr = correlations[si] || [];

      let bestMatch: { networkEvent: NetworkEvent; domEvent: DOMEvent | null } | null = null;

      for (const corr of sessionCorr) {
        for (const ni of corr.networkEventIndices) {
          const ne = session.networkEvents[ni];
          if (ne.method === refMethod && normalizeUrlForMatching(ne.url) === refNormUrl) {
            bestMatch = {
              networkEvent: ne,
              domEvent: session.domEvents[corr.domEventIndex] || null,
            };
            break;
          }
        }
        if (bestMatch) break;
      }

      // Fallback: search all network events if correlation matching failed
      if (!bestMatch) {
        for (const ne of session.networkEvents) {
          if (ne.method === refMethod && normalizeUrlForMatching(ne.url) === refNormUrl) {
            bestMatch = { networkEvent: ne, domEvent: null };
            break;
          }
        }
      }

      if (bestMatch) {
        sessionEvents.push(bestMatch);
      }
    }

    steps.push({
      order: steps.length,
      sessionEvents,
    });
  }

  return steps;
}

// ---- Full Parameterization Pipeline ----

export async function parameterize(
  sessions: Session[],
  correlations: Correlation[][]
): Promise<ParameterDef[]> {
  // Step 1: Match steps across sessions
  const steps = matchStepsAcrossSessions(sessions, correlations);

  if (steps.length === 0 || sessions.length < 2) {
    // With only one session, we can't diff - return empty params
    // (single session parameters could be inferred from DOM context but that's less reliable)
    return [];
  }

  // Step 2: Diff each step across sessions
  const diffAnalysis = steps.map((step) => {
    const urls = step.sessionEvents.map((se) => se.networkEvent.url);
    const pathSegmentSets = urls.map(extractPathSegments);
    const queryParamSets = urls.map(extractQueryParams);
    const bodySets = step.sessionEvents.map((se) => parseBodySafe(se.networkEvent.requestBody));
    const headerSets = step.sessionEvents.map((se) => se.networkEvent.requestHeaders);

    const varyingParts: VaryingPart[] = [];

    // Path diffs
    const pathDiffs = diffPathSegments(pathSegmentSets);
    for (const diff of pathDiffs) {
      varyingParts.push({
        location: 'path',
        key: `segment_${diff.segmentIndex}`,
        values: diff.values,
      });
    }

    // Query diffs
    const queryDiffs = diffQueryParams(queryParamSets);
    for (const diff of queryDiffs) {
      varyingParts.push({
        location: 'query',
        key: diff.key,
        values: diff.values,
      });
    }

    // Body diffs
    const bodyDiffs = diffBodies(bodySets);
    for (const diff of bodyDiffs) {
      varyingParts.push({
        location: 'body',
        key: diff.key,
        values: diff.values,
      });
    }

    // Header diffs
    const headerDiffsResult = diffHeaders(headerSets);
    for (const diff of headerDiffsResult) {
      varyingParts.push({
        location: 'header',
        key: diff.key,
        values: diff.values,
      });
    }

    // Get DOM context from the first session
    const domEvent = step.sessionEvents[0]?.domEvent;

    return {
      step: step.order,
      url: urls[0],
      method: step.sessionEvents[0].networkEvent.method,
      varyingParts,
      domContext: domEvent
        ? {
            type: domEvent.type,
            selector: domEvent.selector,
            elementContext: domEvent.elementContext,
            value: domEvent.value,
          }
        : null,
    };
  });

  // Filter to steps that actually have varying parts
  const stepsWithVariation = diffAnalysis.filter((d) => d.varyingParts.length > 0);

  if (stepsWithVariation.length === 0) {
    return [];
  }

  // Step 3: LLM enrichment to name and describe parameters
  try {
    const parameters = await parameterizeWorkflow(stepsWithVariation);
    return parameters;
  } catch (error) {
    console.warn('LLM parameterization failed, generating basic parameters:', (error as Error).message);

    // Fallback: generate basic parameters from diff analysis
    return stepsWithVariation.flatMap((step) =>
      step.varyingParts.map((vp) => ({
        name: vp.key.replace(/[^a-zA-Z0-9]/g, '_'),
        type: 'string' as const,
        required: true,
        description: `Variable ${vp.location} parameter "${vp.key}" in step ${step.step}`,
        example: vp.values[0] || '',
        usedIn: [{ step: step.step, location: vp.location, key: vp.key }],
      }))
    );
  }
}
