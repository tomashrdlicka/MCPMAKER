// ============================================================
// MCPMAKER Engine - HTTP Server
// Pure Node.js HTTP server (no Express) on localhost:7433
// ============================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { ENGINE_PORT } from './types.js';
import * as db from './database.js';
import { runAnalysisPipeline } from './analysis/index.js';
import {
  generateMcpServer,
  startMcpServer,
  stopMcpServer,
  getMcpServerStatus,
} from './mcp-generator.js';
import { resetClient, getNextPlaybackAction, extractWorkflowIntent } from './analysis/llm.js';
import type {
  Session,
  PlaybackState,
  NextActionRequest,
  NextActionResponse,
  IntentRequest,
  IntentResponse,
  PlaybackLogRequest,
  PlaybackLogResponse,
} from './types.js';

// ---- CORS ----

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ---- JSON Helpers ----

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { error: message });
}

async function parseJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (!body) {
          reject(new Error('Request body is empty'));
          return;
        }
        resolve(JSON.parse(body) as T);
      } catch (e) {
        reject(new Error(`Invalid JSON in request body: ${(e as Error).message}`));
      }
    });
    req.on('error', reject);
  });
}

// ---- URL Parsing ----

function parseUrl(req: IncomingMessage): { pathname: string; query: URLSearchParams } {
  const url = new URL(req.url || '/', `http://localhost:${ENGINE_PORT}`);
  return { pathname: url.pathname, query: url.searchParams };
}

// ---- Route Matching ----

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].substring(1)] = pathParts[i];
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }

  return { params };
}

// ---- Playback State (in-memory tracking) ----

const playbackStates = new Map<string, PlaybackState>();

// ---- Route Handlers ----

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const { pathname, query } = parseUrl(req);
  const method = req.method || 'GET';

  try {
    // ---- Health Check ----
    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        version: '0.1.0',
        uptime: process.uptime(),
        databasePath: db.getDatabasePath(),
      });
      return;
    }

    // ---- Sessions ----

    // POST /sessions - Create a new session
    if (method === 'POST' && pathname === '/sessions') {
      const body = await parseJsonBody<{ session?: Session }>(req);

      if (!body.session) {
        sendError(res, 400, 'Missing required field: session');
        return;
      }

      const session = body.session;

      // Validate required fields
      if (!session.workflowName) {
        sendError(res, 400, 'Missing required field: session.workflowName');
        return;
      }
      if (!session.url) {
        sendError(res, 400, 'Missing required field: session.url');
        return;
      }
      if (typeof session.startedAt !== 'number') {
        sendError(res, 400, 'Missing required field: session.startedAt (must be a number)');
        return;
      }
      if (typeof session.endedAt !== 'number') {
        sendError(res, 400, 'Missing required field: session.endedAt (must be a number)');
        return;
      }
      if (!Array.isArray(session.domEvents)) {
        sendError(res, 400, 'Missing required field: session.domEvents (must be an array)');
        return;
      }
      if (!Array.isArray(session.networkEvents)) {
        sendError(res, 400, 'Missing required field: session.networkEvents (must be an array)');
        return;
      }

      // Default correlations to empty array if not provided
      if (!session.correlations) {
        session.correlations = [];
      }

      const result = db.createSession(session);
      sendJson(res, 201, {
        id: result.id,
        workflowName: session.workflowName,
        workflowId: result.workflowId,
      });
      return;
    }

    // GET /sessions - List sessions
    if (method === 'GET' && pathname === '/sessions') {
      const workflowId = query.get('workflowId') || undefined;
      const sessions = db.getSessions(workflowId);
      sendJson(res, 200, { sessions });
      return;
    }

    // GET /sessions/:id - Get a specific session
    const sessionMatch = matchRoute('/sessions/:id', pathname);
    if (method === 'GET' && sessionMatch) {
      const session = db.getSession(sessionMatch.params.id);
      if (!session) {
        sendError(res, 404, `Session not found: ${sessionMatch.params.id}`);
        return;
      }
      sendJson(res, 200, { session });
      return;
    }

    // ---- Analysis ----

    // POST /analyze - Trigger the analysis pipeline
    if (method === 'POST' && pathname === '/analyze') {
      const body = await parseJsonBody<{ workflowId?: string; sessionIds?: string[] }>(req);

      if (!body.workflowId) {
        sendError(res, 400, 'Missing required field: workflowId');
        return;
      }
      if (!body.sessionIds || !Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
        sendError(res, 400, 'Missing required field: sessionIds (must be a non-empty array)');
        return;
      }

      // Verify workflow exists
      const workflow = db.getWorkflow(body.workflowId);
      if (!workflow) {
        sendError(res, 404, `Workflow not found: ${body.workflowId}`);
        return;
      }

      // Verify API key is configured
      const apiKey = db.getConfig('anthropic_api_key');
      if (!apiKey) {
        sendError(res, 400, 'Anthropic API key not configured. Please set it via POST /config/api-key first.');
        return;
      }

      // Load sessions
      const sessions: Session[] = [];
      for (const sessionId of body.sessionIds) {
        const session = db.getSession(sessionId);
        if (!session) {
          sendError(res, 404, `Session not found: ${sessionId}`);
          return;
        }
        sessions.push(session);
      }

      // Run analysis pipeline
      const result = await runAnalysisPipeline(workflow.name, sessions);

      // Store the definition on the workflow
      db.updateWorkflow(body.workflowId, {
        definition: result.definition,
      });

      sendJson(res, 200, {
        workflowId: body.workflowId,
        definition: result.definition,
        confidence: result.definition.confidence,
        stages: result.stages,
      });
      return;
    }

    // ---- Workflows ----

    // GET /workflows - List all workflows
    if (method === 'GET' && pathname === '/workflows') {
      const workflows = db.getWorkflows();
      sendJson(res, 200, { workflows });
      return;
    }

    // Workflow-specific routes with :id
    const workflowMatch = matchRoute('/workflows/:id', pathname);

    // GET /workflows/:id
    if (method === 'GET' && workflowMatch) {
      const workflow = db.getWorkflow(workflowMatch.params.id);
      if (!workflow) {
        sendError(res, 404, `Workflow not found: ${workflowMatch.params.id}`);
        return;
      }
      sendJson(res, 200, { workflow });
      return;
    }

    // DELETE /workflows/:id
    if (method === 'DELETE' && workflowMatch) {
      const deleted = db.deleteWorkflow(workflowMatch.params.id);
      if (!deleted) {
        sendError(res, 404, `Workflow not found: ${workflowMatch.params.id}`);
        return;
      }
      sendJson(res, 200, { deleted: true });
      return;
    }

    // POST /workflows/:id/play - Trigger visual playback
    const playMatch = matchRoute('/workflows/:id/play', pathname);
    if (method === 'POST' && playMatch) {
      const workflow = db.getWorkflow(playMatch.params.id);
      if (!workflow) {
        sendError(res, 404, `Workflow not found: ${playMatch.params.id}`);
        return;
      }

      if (!workflow.definition) {
        sendError(res, 400, 'Workflow has no definition yet. Run analysis first.');
        return;
      }

      const body = await parseJsonBody<{ parameters?: Record<string, unknown> }>(req);

      // Initialize playback state
      const playbackState: PlaybackState = {
        status: 'starting',
        currentStep: 0,
        totalSteps: workflow.definition.steps.length,
        completedSteps: [],
      };

      playbackStates.set(playMatch.params.id, playbackState);

      sendJson(res, 200, {
        workflowId: playMatch.params.id,
        playbackState,
        message: 'Playback initiated. The extension will control the actual playback. Poll GET /workflows/:id/status for updates.',
      });
      return;
    }

    // POST /workflows/:id/deploy - Deploy as MCP server
    const deployMatch = matchRoute('/workflows/:id/deploy', pathname);
    if (method === 'POST' && deployMatch) {
      const workflow = db.getWorkflow(deployMatch.params.id);
      if (!workflow) {
        sendError(res, 404, `Workflow not found: ${deployMatch.params.id}`);
        return;
      }

      if (!workflow.definition) {
        sendError(res, 400, 'Workflow has no definition yet. Run analysis first.');
        return;
      }

      // Generate the MCP server
      const genResult = generateMcpServer(workflow.definition);

      if (genResult.error) {
        db.updateWorkflow(deployMatch.params.id, {
          mcpServerPath: genResult.serverPath,
          mcpServerStatus: 'error',
        });
        sendJson(res, 500, {
          serverPath: genResult.serverPath,
          status: 'error',
          error: genResult.error,
        });
        return;
      }

      // Start the server
      const startResult = startMcpServer(genResult.serverPath);

      db.updateWorkflow(deployMatch.params.id, {
        mcpServerPath: genResult.serverPath,
        mcpServerStatus: startResult.running ? 'running' : 'error',
      });

      sendJson(res, 200, {
        serverPath: genResult.serverPath,
        status: startResult.running ? 'running' : 'error',
        pid: startResult.pid,
        error: startResult.error,
      });
      return;
    }

    // GET /workflows/:id/status - Check MCP server status
    const statusMatch = matchRoute('/workflows/:id/status', pathname);
    if (method === 'GET' && statusMatch) {
      const workflow = db.getWorkflow(statusMatch.params.id);
      if (!workflow) {
        sendError(res, 404, `Workflow not found: ${statusMatch.params.id}`);
        return;
      }

      // Check playback state
      const playbackState = playbackStates.get(statusMatch.params.id);

      // Check MCP server status
      let mcpStatus: { running: boolean; pid?: number; error?: string } = { running: false };
      if (workflow.mcpServerPath) {
        mcpStatus = getMcpServerStatus(workflow.mcpServerPath);

        // Update DB if status changed
        const newStatus = mcpStatus.running ? 'running' : 'stopped';
        if (newStatus !== workflow.mcpServerStatus) {
          db.updateWorkflow(statusMatch.params.id, { mcpServerStatus: newStatus as 'running' | 'stopped' });
        }
      }

      sendJson(res, 200, {
        workflowId: statusMatch.params.id,
        mcpServer: {
          status: mcpStatus.running ? 'running' : (workflow.mcpServerStatus || 'stopped'),
          path: workflow.mcpServerPath,
          pid: mcpStatus.pid,
          error: mcpStatus.error,
        },
        playback: playbackState || null,
      });
      return;
    }

    // ---- Config ----

    // POST /config/api-key - Store API key
    if (method === 'POST' && pathname === '/config/api-key') {
      const body = await parseJsonBody<{ apiKey?: string }>(req);

      if (!body.apiKey || typeof body.apiKey !== 'string' || body.apiKey.trim().length === 0) {
        sendError(res, 400, 'Missing required field: apiKey (must be a non-empty string)');
        return;
      }

      db.setConfig('anthropic_api_key', body.apiKey.trim());

      // Reset the LLM client so it picks up the new key
      resetClient();

      sendJson(res, 200, { configured: true });
      return;
    }

    // GET /config/api-key - Check if API key is set
    if (method === 'GET' && pathname === '/config/api-key') {
      const apiKey = db.getConfig('anthropic_api_key');
      sendJson(res, 200, { configured: !!apiKey });
      return;
    }

    // ---- Playback (Intelligent) ----

    // POST /playback/next-action - Get next action from Claude
    if (method === 'POST' && pathname === '/playback/next-action') {
      const apiKey = db.getConfig('anthropic_api_key');
      if (!apiKey) {
        sendError(res, 400, 'Anthropic API key not configured. Please set it via POST /config/api-key first.');
        return;
      }

      const body = await parseJsonBody<NextActionRequest>(req);
      if (!body.screenshot || !body.domSnapshot || !body.context || !body.mode) {
        sendError(res, 400, 'Missing required fields: screenshot, domSnapshot, context, mode');
        return;
      }

      const result = await getNextPlaybackAction(body);
      sendJson(res, 200, result);
      return;
    }

    // POST /playback/intent - Extract workflow intent
    if (method === 'POST' && pathname === '/playback/intent') {
      const apiKey = db.getConfig('anthropic_api_key');
      if (!apiKey) {
        sendError(res, 400, 'Anthropic API key not configured. Please set it via POST /config/api-key first.');
        return;
      }

      const body = await parseJsonBody<IntentRequest>(req);
      if (!body.definition || !body.parameters) {
        sendError(res, 400, 'Missing required fields: definition, parameters');
        return;
      }

      const intent = await extractWorkflowIntent(body.definition, body.parameters);
      sendJson(res, 200, { intent } satisfies IntentResponse);
      return;
    }

    // POST /playback/log - Save a playback log entry
    if (method === 'POST' && pathname === '/playback/log') {
      const apiKey = db.getConfig('anthropic_api_key');
      if (!apiKey) {
        sendError(res, 400, 'Anthropic API key not configured. Please set it via POST /config/api-key first.');
        return;
      }

      const body = await parseJsonBody<PlaybackLogRequest>(req);
      if (!body.entry) {
        sendError(res, 400, 'Missing required field: entry');
        return;
      }

      db.savePlaybackLog(body.entry);
      sendJson(res, 200, { saved: true } satisfies PlaybackLogResponse);
      return;
    }

    // GET /playback/insights/:workflowId - Get insights for a workflow's site
    const insightsMatch = matchRoute('/playback/insights/:workflowId', pathname);
    if (method === 'GET' && insightsMatch) {
      const apiKey = db.getConfig('anthropic_api_key');
      if (!apiKey) {
        sendError(res, 400, 'Anthropic API key not configured. Please set it via POST /config/api-key first.');
        return;
      }

      // Look up the workflow to get its sitePattern
      const workflow = db.getWorkflow(insightsMatch.params.workflowId);
      const sitePattern = workflow?.sitePattern ?? insightsMatch.params.workflowId;
      const insights = db.getPlaybackInsights(sitePattern);
      sendJson(res, 200, { insights });
      return;
    }

    // ---- 404 ----
    sendError(res, 404, `Route not found: ${method} ${pathname}`);
  } catch (error) {
    console.error(`Error handling ${method} ${pathname}:`, error);
    sendError(res, 500, `Internal server error: ${(error as Error).message}`);
  }
}

// ---- Server Lifecycle ----

let server: ReturnType<typeof createServer> | null = null;

export function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      handleRequest(req, res).catch((error) => {
        console.error('Unhandled request error:', error);
        try {
          sendError(res, 500, 'Internal server error');
        } catch {
          // Response may already be sent
        }
      });
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${ENGINE_PORT} is already in use. Is another MCPMAKER instance running?`);
        reject(error);
      } else {
        console.error('Server error:', error);
        reject(error);
      }
    });

    server.listen(ENGINE_PORT, '127.0.0.1', () => {
      console.log(`MCPMAKER Engine listening on http://127.0.0.1:${ENGINE_PORT}`);
      resolve();
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
