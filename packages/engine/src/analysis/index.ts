// ============================================================
// MCPMAKER Engine - Analysis Pipeline Orchestrator
// Runs all 6 stages and produces a WorkflowDefinition
// ============================================================

import type {
  Session,
  WorkflowDefinition,
  Correlation,
} from '../types.js';
import { filterNoise } from './noise-filter.js';
import { correlateEvents } from './correlator.js';
import { parameterize } from './parameterizer.js';
import { detectChains } from './chain-detector.js';
import { detectAuth } from './auth-detector.js';
import { generateDefinition } from './definition-generator.js';

export interface AnalysisPipelineResult {
  definition: WorkflowDefinition;
  stages: {
    noiseFilter: { removedCount: number; coreCount: number; supportingCount: number };
    correlation: { correlationCount: number };
    parameterization: { parameterCount: number };
    chainDetection: { chainCount: number; parallelGroupCount: number };
    authDetection: { authType: string; credentialCount: number };
  };
}

export async function runAnalysisPipeline(
  workflowName: string,
  sessions: Session[]
): Promise<AnalysisPipelineResult> {
  if (sessions.length === 0) {
    throw new Error('At least one recording session is required for analysis.');
  }

  console.log(`\n=== Analysis Pipeline: "${workflowName}" ===`);
  console.log(`Processing ${sessions.length} session(s)...\n`);

  // ---- Stage 1: Noise Filtering ----
  console.log('Stage 1/6: Noise Filtering...');

  const filterResults = await Promise.all(
    sessions.map((session) => filterNoise(session, sessions))
  );

  const totalNoise = filterResults.reduce((sum, r) => sum + r.noiseCount, 0);
  const totalCore = filterResults.reduce((sum, r) => sum + r.core.length, 0);
  const totalSupporting = filterResults.reduce((sum, r) => sum + r.supporting.length, 0);

  console.log(`  Removed ${totalNoise} noise events, kept ${totalCore} core + ${totalSupporting} supporting`);

  // ---- Stage 2: Correlation ----
  console.log('Stage 2/6: DOM-Network Correlation...');

  const correlationResults = await Promise.all(
    sessions.map((session, i) =>
      correlateEvents(
        session.domEvents,
        session.networkEvents,
        filterResults[i].coreIndices,
        filterResults[i].supportingIndices
      )
    )
  );

  const allCorrelations = correlationResults.map((r) => r.correlations);
  const totalCorrelations = allCorrelations.reduce((sum, c) => sum + c.length, 0);

  console.log(`  Found ${totalCorrelations} correlations across all sessions`);

  // ---- Stage 3: Parameterization ----
  console.log('Stage 3/6: Parameterization...');

  const parameters = await parameterize(sessions, allCorrelations);

  console.log(`  Identified ${parameters.length} parameter(s)`);

  // ---- Stage 4: Chain Detection ----
  console.log('Stage 4/6: Step Chain Detection...');

  const coreIndicesPerSession = filterResults.map((r) => r.coreIndices);
  const chainResult = await detectChains(sessions, allCorrelations, coreIndicesPerSession);

  console.log(`  Found ${chainResult.chains.length} chain(s), ${chainResult.parallelGroups.length} parallel group(s)`);

  if (chainResult.paginationSteps.length > 0) {
    console.log(`  Detected pagination in step(s): ${chainResult.paginationSteps.join(', ')}`);
  }

  // ---- Stage 5: Auth Detection ----
  console.log('Stage 5/6: Auth Pattern Detection...');

  const authPattern = await detectAuth(sessions);

  console.log(`  Auth type: ${authPattern.type}, ${authPattern.credentialFields.length} credential field(s)`);

  // ---- Stage 6: Definition Generation ----
  console.log('Stage 6/6: WorkflowDefinition Generation...');

  const definition = await generateDefinition(
    workflowName,
    sessions,
    allCorrelations,
    coreIndicesPerSession,
    parameters,
    chainResult,
    authPattern
  );

  console.log(`  Generated definition with ${definition.steps.length} step(s), confidence: ${definition.confidence}`);
  console.log(`\n=== Analysis Complete ===\n`);

  return {
    definition,
    stages: {
      noiseFilter: {
        removedCount: totalNoise,
        coreCount: totalCore,
        supportingCount: totalSupporting,
      },
      correlation: {
        correlationCount: totalCorrelations,
      },
      parameterization: {
        parameterCount: parameters.length,
      },
      chainDetection: {
        chainCount: chainResult.chains.length,
        parallelGroupCount: chainResult.parallelGroups.length,
      },
      authDetection: {
        authType: authPattern.type,
        credentialCount: authPattern.credentialFields.length,
      },
    },
  };
}
