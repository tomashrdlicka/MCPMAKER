// ============================================================
// MCPMAKER Engine - Stage 1: Noise Filtering
// Pre-LLM heuristics + LLM classification of network events
// ============================================================

import type { NetworkEvent, DOMEvent, Session } from '../types.js';
import {
  TRACKING_DOMAINS,
  STATIC_CONTENT_TYPES,
  STATIC_EXTENSIONS,
} from '../types.js';
import { classifyNetworkEvents, redactNetworkEvent } from './llm.js';

export interface FilteredEvents {
  /** Network events classified as CORE */
  core: NetworkEvent[];
  /** Network events classified as SUPPORTING */
  supporting: NetworkEvent[];
  /** Original indices of core events in the session's networkEvents array */
  coreIndices: number[];
  /** Original indices of supporting events */
  supportingIndices: number[];
  /** Count of noise events removed */
  noiseCount: number;
}

// ---- Heuristic Filters ----

function isTrackingDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return TRACKING_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function isStaticAsset(event: NetworkEvent): boolean {
  // Check content-type header
  const contentType = (
    event.responseHeaders['content-type'] ||
    event.responseHeaders['Content-Type'] ||
    ''
  ).toLowerCase();

  if (STATIC_CONTENT_TYPES.some((ct) => contentType.startsWith(ct))) {
    return true;
  }

  // Check URL extension
  try {
    const pathname = new URL(event.url).pathname;
    return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function isPreflightRequest(event: NetworkEvent): boolean {
  return event.method === 'OPTIONS';
}

function isIdenticalAcrossRecordings(
  event: NetworkEvent,
  allSessions: Session[]
): boolean {
  if (allSessions.length < 2) return false;

  // Check if this exact URL+method appears in ALL other sessions
  const matchCount = allSessions.filter((session) =>
    session.networkEvents.some(
      (ne) => ne.url === event.url && ne.method === event.method
    )
  ).length;

  // If it appears in all sessions with the exact same URL (no variable parts),
  // it's likely navigation/analytics/framework code
  return matchCount === allSessions.length;
}

// ---- Pre-LLM Heuristic Pass ----

export function applyHeuristicFilters(
  events: NetworkEvent[],
  allSessions: Session[]
): { passed: Array<{ event: NetworkEvent; originalIndex: number }>; removedCount: number } {
  const passed: Array<{ event: NetworkEvent; originalIndex: number }> = [];
  let removedCount = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (isTrackingDomain(event.url)) {
      removedCount++;
      continue;
    }

    if (isStaticAsset(event)) {
      removedCount++;
      continue;
    }

    if (isPreflightRequest(event)) {
      removedCount++;
      continue;
    }

    if (isIdenticalAcrossRecordings(event, allSessions)) {
      removedCount++;
      continue;
    }

    passed.push({ event, originalIndex: i });
  }

  return { passed, removedCount };
}

// ---- Full Noise Filter (Heuristic + LLM) ----

export async function filterNoise(
  session: Session,
  allSessions: Session[]
): Promise<FilteredEvents> {
  // Step 1: Apply heuristic filters
  const { passed, removedCount } = applyHeuristicFilters(
    session.networkEvents,
    allSessions
  );

  if (passed.length === 0) {
    return {
      core: [],
      supporting: [],
      coreIndices: [],
      supportingIndices: [],
      noiseCount: removedCount,
    };
  }

  // Step 2: Send remaining events to LLM for classification
  let classifications: Array<{
    index: number;
    classification: 'CORE' | 'SUPPORTING' | 'NOISE';
    reason: string;
  }>;

  try {
    classifications = await classifyNetworkEvents(
      passed.map((p) => p.event),
      session.domEvents
    );
  } catch (error) {
    // If LLM fails, fall back to treating all heuristic-passed events as CORE
    console.warn('LLM classification failed, using heuristic results only:', (error as Error).message);
    return {
      core: passed.map((p) => p.event),
      supporting: [],
      coreIndices: passed.map((p) => p.originalIndex),
      supportingIndices: [],
      noiseCount: removedCount,
    };
  }

  // Step 3: Separate into CORE, SUPPORTING, NOISE
  const core: NetworkEvent[] = [];
  const supporting: NetworkEvent[] = [];
  const coreIndices: number[] = [];
  const supportingIndices: number[] = [];
  let llmNoiseCount = 0;

  for (const classification of classifications) {
    const passedEntry = passed[classification.index];
    if (!passedEntry) continue;

    switch (classification.classification) {
      case 'CORE':
        core.push(passedEntry.event);
        coreIndices.push(passedEntry.originalIndex);
        break;
      case 'SUPPORTING':
        supporting.push(passedEntry.event);
        supportingIndices.push(passedEntry.originalIndex);
        break;
      case 'NOISE':
        llmNoiseCount++;
        break;
    }
  }

  // Also include any events that the LLM didn't classify (safety net)
  const classifiedIndices = new Set(classifications.map((c) => c.index));
  for (let i = 0; i < passed.length; i++) {
    if (!classifiedIndices.has(i)) {
      // Unclassified events default to SUPPORTING
      supporting.push(passed[i].event);
      supportingIndices.push(passed[i].originalIndex);
    }
  }

  return {
    core,
    supporting,
    coreIndices,
    supportingIndices,
    noiseCount: removedCount + llmNoiseCount,
  };
}
