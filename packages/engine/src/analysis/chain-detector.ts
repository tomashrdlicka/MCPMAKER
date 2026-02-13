// ============================================================
// MCPMAKER Engine - Stage 4: Step Chain Detection
// Identifies data flow between API steps, parallelism,
// pagination, and loop patterns
// ============================================================

import type {
  NetworkEvent,
  Session,
  Correlation,
  StepInputMapping,
} from '../types.js';
import { validateStepChains } from './llm.js';

export interface StepChain {
  fromStep: number;
  toStep: number;
  inputMappings: StepInputMapping[];
  isParallel: boolean;
  isPagination: boolean;
}

export interface ChainDetectionResult {
  chains: StepChain[];
  /** Step indices that can run in parallel (no incoming dependencies) */
  parallelGroups: number[][];
  /** Step indices that form pagination loops */
  paginationSteps: number[];
  /** Execution order respecting dependencies */
  executionOrder: number[];
}

// ---- JSON Path Extraction ----

function flattenJson(obj: unknown, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};

  if (obj === null || obj === undefined) return result;

  if (typeof obj !== 'object') {
    result[prefix || '$'] = String(obj);
    return result;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const childPrefix = prefix ? `${prefix}[${i}]` : `$[${i}]`;
      Object.assign(result, flattenJson(obj[i], childPrefix));
    }
    return result;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const childPrefix = prefix ? `${prefix}.${key}` : `$.${key}`;
    Object.assign(result, flattenJson(value, childPrefix));
  }

  return result;
}

function parseJsonSafe(str: string | undefined): Record<string, unknown> | null {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

// ---- Data Flow Detection ----

interface DataFlow {
  sourceJsonPath: string;
  sourceValue: string;
  targetLocation: 'path' | 'query' | 'body' | 'header';
  targetKey: string;
  targetValue: string;
}

function findDataFlows(
  sourceResponse: NetworkEvent,
  targetRequest: NetworkEvent
): DataFlow[] {
  const flows: DataFlow[] = [];

  // Extract all values from the source response body
  const responseBody = parseJsonSafe(sourceResponse.responseBody);
  if (!responseBody) return flows;

  const sourceValues = flattenJson(responseBody);

  // Extract all values from the target request
  const targetUrl = new URL(targetRequest.url);

  // Check path segments
  const pathSegments = targetUrl.pathname.split('/').filter(Boolean);
  for (const [jsonPath, sourceVal] of Object.entries(sourceValues)) {
    if (!sourceVal || sourceVal.length < 2) continue; // Skip trivial values

    // Check URL path
    for (let i = 0; i < pathSegments.length; i++) {
      if (pathSegments[i] === sourceVal) {
        flows.push({
          sourceJsonPath: jsonPath,
          sourceValue: sourceVal,
          targetLocation: 'path',
          targetKey: `segment_${i}`,
          targetValue: pathSegments[i],
        });
      }
    }

    // Check query parameters
    for (const [qKey, qValue] of targetUrl.searchParams.entries()) {
      if (qValue === sourceVal) {
        flows.push({
          sourceJsonPath: jsonPath,
          sourceValue: sourceVal,
          targetLocation: 'query',
          targetKey: qKey,
          targetValue: qValue,
        });
      }
    }

    // Check request body
    const requestBody = parseJsonSafe(targetRequest.requestBody);
    if (requestBody) {
      const targetValues = flattenJson(requestBody);
      for (const [targetPath, targetVal] of Object.entries(targetValues)) {
        if (targetVal === sourceVal) {
          // Convert from $.foo.bar to just foo.bar for the key
          const bodyKey = targetPath.startsWith('$.') ? targetPath.substring(2) : targetPath;
          flows.push({
            sourceJsonPath: jsonPath,
            sourceValue: sourceVal,
            targetLocation: 'body',
            targetKey: bodyKey,
            targetValue: targetVal,
          });
        }
      }
    }

    // Check headers (less common but possible, e.g., CSRF tokens)
    for (const [hKey, hValue] of Object.entries(targetRequest.requestHeaders)) {
      if (hValue === sourceVal) {
        flows.push({
          sourceJsonPath: jsonPath,
          sourceValue: sourceVal,
          targetLocation: 'header',
          targetKey: hKey,
          targetValue: hValue,
        });
      }
    }
  }

  return flows;
}

// ---- Pagination Detection (Heuristic) ----

function isPaginationPattern(
  events: NetworkEvent[]
): { isPagination: boolean; varyingParam?: string } {
  if (events.length < 2) return { isPagination: false };

  // Check if the same endpoint is called multiple times with different offsets/page params
  const urls = events.map((e) => {
    try {
      const url = new URL(e.url);
      return { origin: url.origin, pathname: url.pathname, params: url.searchParams };
    } catch {
      return null;
    }
  }).filter(Boolean) as Array<{ origin: string; pathname: string; params: URLSearchParams }>;

  // Group by origin+pathname
  const groups = new Map<string, URLSearchParams[]>();
  for (const u of urls) {
    const key = `${u.origin}${u.pathname}`;
    const existing = groups.get(key) || [];
    existing.push(u.params);
    groups.set(key, existing);
  }

  for (const [, paramSets] of groups) {
    if (paramSets.length < 2) continue;

    // Find params that change
    const allKeys = new Set<string>();
    for (const ps of paramSets) {
      ps.forEach((_, key) => allKeys.add(key));
    }

    for (const key of allKeys) {
      const values = paramSets.map((ps) => ps.get(key) || '');
      const numericValues = values.map(Number).filter((n) => !isNaN(n));

      // Pagination params are often sequential numbers or offsets
      if (numericValues.length === paramSets.length) {
        const sorted = [...numericValues].sort((a, b) => a - b);
        const isSequential = sorted.every(
          (v, i) => i === 0 || v > sorted[i - 1]
        );
        if (isSequential) {
          const paginationKeys = ['page', 'offset', 'skip', 'start', 'cursor', 'after', 'before', 'limit'];
          if (paginationKeys.includes(key.toLowerCase())) {
            return { isPagination: true, varyingParam: key };
          }
        }
      }
    }
  }

  return { isPagination: false };
}

// ---- Topological Sort for Execution Order ----

function topologicalSort(
  numSteps: number,
  dependencies: Map<number, Set<number>>
): number[] {
  const inDegree = new Array(numSteps).fill(0);
  const adjList = new Map<number, number[]>();

  for (const [to, fromSet] of dependencies.entries()) {
    inDegree[to] = fromSet.size;
    for (const from of fromSet) {
      const existing = adjList.get(from) || [];
      existing.push(to);
      adjList.set(from, existing);
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < numSteps; i++) {
    if (inDegree[i] === 0) {
      queue.push(i);
    }
  }

  const result: number[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of adjList.get(node) || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If we couldn't sort all nodes, there's a cycle - add remaining
  if (result.length < numSteps) {
    for (let i = 0; i < numSteps; i++) {
      if (!result.includes(i)) {
        result.push(i);
      }
    }
  }

  return result;
}

// ---- Parallel Group Detection ----

function findParallelGroups(
  numSteps: number,
  dependencies: Map<number, Set<number>>
): number[][] {
  // Steps with no dependencies on each other can run in parallel
  const groups: number[][] = [];
  const assigned = new Set<number>();

  // Group steps by their dependency depth
  const depths = new Map<number, number>();

  function getDepth(step: number): number {
    if (depths.has(step)) return depths.get(step)!;

    const deps = dependencies.get(step);
    if (!deps || deps.size === 0) {
      depths.set(step, 0);
      return 0;
    }

    const maxDepDep = Math.max(...[...deps].map(getDepth));
    const depth = maxDepDep + 1;
    depths.set(step, depth);
    return depth;
  }

  for (let i = 0; i < numSteps; i++) {
    getDepth(i);
  }

  // Group by depth
  const depthGroups = new Map<number, number[]>();
  for (let i = 0; i < numSteps; i++) {
    const d = depths.get(i) || 0;
    const existing = depthGroups.get(d) || [];
    existing.push(i);
    depthGroups.set(d, existing);
  }

  // Only groups with 2+ steps are meaningful parallel groups
  for (const [, group] of [...depthGroups.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length >= 2) {
      groups.push(group);
    }
  }

  return groups;
}

// ---- Full Chain Detection Pipeline ----

export async function detectChains(
  sessions: Session[],
  correlations: Correlation[][],
  coreNetworkIndices: number[][]
): Promise<ChainDetectionResult> {
  // Use the first session as the reference
  const refSession = sessions[0];
  const refCorrelations = correlations[0] || [];
  const refCoreIndices = coreNetworkIndices[0] || [];

  // Build ordered list of core network events from correlations
  const orderedSteps: NetworkEvent[] = [];
  const stepDescriptions: Array<{
    order: number;
    method: string;
    url: string;
    description: string;
  }> = [];

  for (const corr of refCorrelations) {
    for (const ni of corr.networkEventIndices) {
      if (refCoreIndices.includes(ni)) {
        const ne = refSession.networkEvents[ni];
        const de = refSession.domEvents[corr.domEventIndex];
        orderedSteps.push(ne);
        stepDescriptions.push({
          order: orderedSteps.length - 1,
          method: ne.method,
          url: ne.url,
          description: de
            ? `${de.type} on "${de.elementContext}" -> ${ne.method} ${new URL(ne.url).pathname}`
            : `${ne.method} ${new URL(ne.url).pathname}`,
        });
      }
    }
  }

  if (orderedSteps.length < 2) {
    return {
      chains: [],
      parallelGroups: [],
      paginationSteps: [],
      executionOrder: orderedSteps.map((_, i) => i),
    };
  }

  // Step 1: Find data flows between consecutive and non-consecutive steps
  const proposedChains: Array<{
    fromStep: number;
    toStep: number;
    fromUrl: string;
    toUrl: string;
    dataFlows: DataFlow[];
  }> = [];

  for (let from = 0; from < orderedSteps.length; from++) {
    for (let to = from + 1; to < orderedSteps.length; to++) {
      const flows = findDataFlows(orderedSteps[from], orderedSteps[to]);
      if (flows.length > 0) {
        proposedChains.push({
          fromStep: from,
          toStep: to,
          fromUrl: orderedSteps[from].url,
          toUrl: orderedSteps[to].url,
          dataFlows: flows,
        });
      }
    }
  }

  // Step 2: Check for pagination patterns
  const { isPagination } = isPaginationPattern(orderedSteps);
  const paginationSteps: number[] = [];
  if (isPagination) {
    // Find the repeating steps
    const urlCounts = new Map<string, number[]>();
    for (let i = 0; i < orderedSteps.length; i++) {
      try {
        const key = `${orderedSteps[i].method} ${new URL(orderedSteps[i].url).pathname}`;
        const existing = urlCounts.get(key) || [];
        existing.push(i);
        urlCounts.set(key, existing);
      } catch {
        // Skip malformed URLs
      }
    }

    for (const [, indices] of urlCounts) {
      if (indices.length >= 2) {
        paginationSteps.push(...indices);
      }
    }
  }

  // Step 3: LLM validation
  let validatedChains: StepChain[];

  try {
    const llmResults = await validateStepChains(proposedChains, stepDescriptions);

    validatedChains = llmResults
      .filter((r) => r.confirmed)
      .map((r) => ({
        fromStep: r.fromStep,
        toStep: r.toStep,
        inputMappings: r.inputMappings,
        isParallel: r.isParallel,
        isPagination: r.isPagination,
      }));

    // Add pagination steps from LLM
    for (const r of llmResults) {
      if (r.isPagination && !paginationSteps.includes(r.toStep)) {
        paginationSteps.push(r.toStep);
      }
    }
  } catch (error) {
    console.warn('LLM chain validation failed, using heuristic chains:', (error as Error).message);

    // Fallback: use all proposed chains as confirmed
    validatedChains = proposedChains.map((pc) => ({
      fromStep: pc.fromStep,
      toStep: pc.toStep,
      inputMappings: pc.dataFlows.map((df) => ({
        sourceStep: pc.fromStep,
        sourceJsonPath: df.sourceJsonPath,
        targetLocation: df.targetLocation,
        targetKey: df.targetKey,
        description: `Pass ${df.sourceJsonPath} from step ${pc.fromStep} to ${df.targetLocation}:${df.targetKey} in step ${pc.toStep}`,
      })),
      isParallel: false,
      isPagination: false,
    }));
  }

  // Step 4: Build dependency graph
  const dependencies = new Map<number, Set<number>>();
  for (const chain of validatedChains) {
    if (chain.isParallel) continue;

    const deps = dependencies.get(chain.toStep) || new Set();
    deps.add(chain.fromStep);
    dependencies.set(chain.toStep, deps);
  }

  // Step 5: Compute execution order and parallel groups
  const executionOrder = topologicalSort(orderedSteps.length, dependencies);
  const parallelGroups = findParallelGroups(orderedSteps.length, dependencies);

  // Cross-validate chains across sessions
  if (sessions.length > 1) {
    for (const chain of validatedChains) {
      let validInAllSessions = true;

      for (let si = 1; si < sessions.length; si++) {
        const sessionCorr = correlations[si] || [];
        const sessionCoreIdx = coreNetworkIndices[si] || [];

        // Get the corresponding steps in this session
        const sessionSteps: NetworkEvent[] = [];
        for (const corr of sessionCorr) {
          for (const ni of corr.networkEventIndices) {
            if (sessionCoreIdx.includes(ni)) {
              sessionSteps.push(sessions[si].networkEvents[ni]);
            }
          }
        }

        if (chain.fromStep < sessionSteps.length && chain.toStep < sessionSteps.length) {
          const flows = findDataFlows(sessionSteps[chain.fromStep], sessionSteps[chain.toStep]);
          if (flows.length === 0) {
            validInAllSessions = false;
            break;
          }
        }
      }

      // If chain doesn't hold across sessions, it might be session-specific
      if (!validInAllSessions) {
        // Don't remove it, but mark it with lower confidence by removing data-flow-based mappings
        // The chain itself might still be temporal
      }
    }
  }

  return {
    chains: validatedChains,
    parallelGroups,
    paginationSteps,
    executionOrder,
  };
}
