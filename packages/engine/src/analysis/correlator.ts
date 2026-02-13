// ============================================================
// MCPMAKER Engine - Stage 2: DOM-Network Correlation
// Maps user interactions to the API calls they trigger
// ============================================================

import type {
  DOMEvent,
  NetworkEvent,
  Correlation,
} from '../types.js';
import { validateCorrelations } from './llm.js';

export interface CorrelationResult {
  correlations: Correlation[];
  /** Network events that are correlated to at least one DOM event */
  correlatedNetworkIndices: Set<number>;
  /** DOM events that triggered at least one network event */
  correlatedDomIndices: Set<number>;
}

// Default time window: 2 seconds after a DOM event to look for related network events
const DEFAULT_WINDOW_MS = 2000;
// Extended window for events that might trigger async loading (e.g., clicking a tab that loads content)
const EXTENDED_WINDOW_MS = 5000;

// DOM events that commonly trigger longer async operations
const ASYNC_DOM_TYPES = new Set(['navigate', 'submit']);

// ---- Temporal Correlation ----

function buildTemporalCorrelations(
  domEvents: DOMEvent[],
  networkEvents: NetworkEvent[],
  coreNetworkIndices: number[],
  supportingNetworkIndices: number[]
): Correlation[] {
  // Build a sorted timeline of relevant network events
  const relevantIndices = new Set([...coreNetworkIndices, ...supportingNetworkIndices]);

  // For each DOM event, find network events in its time window
  const correlations: Correlation[] = [];

  for (let di = 0; di < domEvents.length; di++) {
    const domEvent = domEvents[di];
    const windowMs = ASYNC_DOM_TYPES.has(domEvent.type)
      ? EXTENDED_WINDOW_MS
      : DEFAULT_WINDOW_MS;

    const windowStart = domEvent.timestamp;
    const windowEnd = domEvent.timestamp + windowMs;

    // Find the next DOM event's timestamp to avoid overlap
    const nextDomTimestamp = di < domEvents.length - 1
      ? domEvents[di + 1].timestamp
      : Infinity;

    // Limit window to not overlap with next DOM event (with some grace period)
    const effectiveEnd = Math.min(windowEnd, nextDomTimestamp + 500);

    const matchedNetworkIndices: number[] = [];
    let minTimeGap = Infinity;

    for (const ni of relevantIndices) {
      const networkEvent = networkEvents[ni];

      // Network event must come after the DOM event
      if (networkEvent.timestamp >= windowStart && networkEvent.timestamp <= effectiveEnd) {
        matchedNetworkIndices.push(ni);
        const gap = networkEvent.timestamp - windowStart;
        if (gap < minTimeGap) {
          minTimeGap = gap;
        }
      }
    }

    if (matchedNetworkIndices.length > 0) {
      correlations.push({
        domEventIndex: di,
        networkEventIndices: matchedNetworkIndices,
        timeGap: minTimeGap,
      });
    }
  }

  return correlations;
}

// ---- Deduplication ----

/**
 * If multiple DOM events claim the same network event, assign it to the
 * closest DOM event by timestamp.
 */
function deduplicateCorrelations(correlations: Correlation[]): Correlation[] {
  // Track which network events are claimed by which DOM events
  const networkToDom = new Map<number, { domIndex: number; gap: number }>();

  for (const corr of correlations) {
    for (const ni of corr.networkEventIndices) {
      const existing = networkToDom.get(ni);
      if (!existing || corr.timeGap < existing.gap) {
        networkToDom.set(ni, { domIndex: corr.domEventIndex, gap: corr.timeGap });
      }
    }
  }

  // Rebuild correlations with deduplicated assignments
  const domToNetwork = new Map<number, number[]>();
  const domToGap = new Map<number, number>();

  for (const [ni, assignment] of networkToDom.entries()) {
    const existing = domToNetwork.get(assignment.domIndex) || [];
    existing.push(ni);
    domToNetwork.set(assignment.domIndex, existing);

    const existingGap = domToGap.get(assignment.domIndex);
    if (existingGap === undefined || assignment.gap < existingGap) {
      domToGap.set(assignment.domIndex, assignment.gap);
    }
  }

  const result: Correlation[] = [];
  for (const [domIndex, networkIndices] of domToNetwork.entries()) {
    result.push({
      domEventIndex: domIndex,
      networkEventIndices: networkIndices.sort((a, b) => a - b),
      timeGap: domToGap.get(domIndex) || 0,
    });
  }

  return result.sort((a, b) => a.domEventIndex - b.domEventIndex);
}

// ---- Full Correlation Pipeline ----

export async function correlateEvents(
  domEvents: DOMEvent[],
  networkEvents: NetworkEvent[],
  coreNetworkIndices: number[],
  supportingNetworkIndices: number[]
): Promise<CorrelationResult> {
  // Step 1: Build temporal correlations
  const rawCorrelations = buildTemporalCorrelations(
    domEvents,
    networkEvents,
    coreNetworkIndices,
    supportingNetworkIndices
  );

  // Step 2: Deduplicate
  const deduplicated = deduplicateCorrelations(rawCorrelations);

  // Step 3: LLM validation
  let validatedCorrelations: Correlation[];

  try {
    const correlationsForLlm = deduplicated.map((corr) => ({
      domEvent: domEvents[corr.domEventIndex],
      networkEvents: corr.networkEventIndices.map((ni) => networkEvents[ni]),
      timeGap: corr.timeGap,
    }));

    const llmResults = await validateCorrelations(correlationsForLlm);

    validatedCorrelations = llmResults
      .filter((r) => r.confidence !== 'low')
      .map((r) => {
        const originalCorr = deduplicated[r.domEventIndex];
        if (!originalCorr) return null;

        // Map the LLM's valid network indices back to global indices
        const validGlobalIndices = r.validNetworkIndices
          .map((localIdx) => originalCorr.networkEventIndices[localIdx])
          .filter((idx): idx is number => idx !== undefined);

        return {
          domEventIndex: originalCorr.domEventIndex,
          networkEventIndices: validGlobalIndices.length > 0
            ? validGlobalIndices
            : originalCorr.networkEventIndices,
          timeGap: originalCorr.timeGap,
        };
      })
      .filter((c): c is Correlation => c !== null);
  } catch (error) {
    // If LLM validation fails, use temporal correlations as-is
    console.warn('LLM correlation validation failed, using temporal correlations:', (error as Error).message);
    validatedCorrelations = deduplicated;
  }

  // Build index sets
  const correlatedNetworkIndices = new Set<number>();
  const correlatedDomIndices = new Set<number>();

  for (const corr of validatedCorrelations) {
    correlatedDomIndices.add(corr.domEventIndex);
    for (const ni of corr.networkEventIndices) {
      correlatedNetworkIndices.add(ni);
    }
  }

  return {
    correlations: validatedCorrelations,
    correlatedNetworkIndices,
    correlatedDomIndices,
  };
}
