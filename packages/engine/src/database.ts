// ============================================================
// MCPMAKER Engine - SQLite Database Layer
// Uses better-sqlite3 for synchronous, fast local storage
// ============================================================

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type {
  Session,
  Workflow,
  WorkflowDefinition,
  PlaybackLogEntry,
} from './types.js';

const MCPMAKER_DIR = join(homedir(), '.mcpmaker');
const DB_PATH = join(MCPMAKER_DIR, 'mcpmaker.db');

let db: Database.Database;

// ---- Initialization ----

export function initDatabase(): void {
  // Ensure ~/.mcpmaker directory exists
  if (!existsSync(MCPMAKER_DIR)) {
    mkdirSync(MCPMAKER_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
}

function createTables(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      workflow_name TEXT NOT NULL,
      url TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      dom_events TEXT NOT NULL DEFAULT '[]',
      network_events TEXT NOT NULL DEFAULT '[]',
      correlations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      site_pattern TEXT NOT NULL DEFAULT '',
      definition TEXT,
      mcp_server_path TEXT,
      mcp_server_status TEXT DEFAULT 'stopped',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_sessions (
      workflow_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY (workflow_id, session_id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playback_logs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      site_pattern TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      outcome TEXT NOT NULL DEFAULT 'partial',
      insights TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_workflow_id ON sessions(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_sessions_workflow ON workflow_sessions(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_sessions_session ON workflow_sessions(session_id);
    CREATE INDEX IF NOT EXISTS idx_playback_logs_workflow ON playback_logs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_playback_logs_site ON playback_logs(site_pattern);
  `);
}

// ---- Helper: generate a URL-based site pattern from a URL ----

function extractSitePattern(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

// ---- Helper: generate a simple unique ID ----

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

// ---- Session Methods ----

export function createSession(session: Session): { id: string; workflowId: string } {
  // Find or create workflow by name
  let workflowId: string;
  const existingWorkflow = db.prepare(
    'SELECT id FROM workflows WHERE name = ?'
  ).get(session.workflowName) as { id: string } | undefined;

  if (existingWorkflow) {
    workflowId = existingWorkflow.id;
  } else {
    workflowId = generateId();
    const sitePattern = extractSitePattern(session.url);
    db.prepare(
      `INSERT INTO workflows (id, name, site_pattern, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    ).run(workflowId, session.workflowName, sitePattern);
  }

  // Store the session
  const sessionId = session.id || generateId();
  db.prepare(
    `INSERT INTO sessions (id, workflow_id, workflow_name, url, started_at, ended_at, dom_events, network_events, correlations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    workflowId,
    session.workflowName,
    session.url,
    session.startedAt,
    session.endedAt,
    JSON.stringify(session.domEvents),
    JSON.stringify(session.networkEvents),
    JSON.stringify(session.correlations)
  );

  // Link session to workflow
  db.prepare(
    'INSERT OR IGNORE INTO workflow_sessions (workflow_id, session_id) VALUES (?, ?)'
  ).run(workflowId, sessionId);

  // Update the workflow's updated_at timestamp
  db.prepare(
    "UPDATE workflows SET updated_at = datetime('now') WHERE id = ?"
  ).run(workflowId);

  return { id: sessionId, workflowId };
}

export function getSession(id: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    workflowName: row.workflow_name as string,
    url: row.url as string,
    startedAt: row.started_at as number,
    endedAt: row.ended_at as number,
    domEvents: JSON.parse(row.dom_events as string),
    networkEvents: JSON.parse(row.network_events as string),
    correlations: JSON.parse(row.correlations as string),
  };
}

export function getSessions(workflowId?: string): Session[] {
  let rows: Record<string, unknown>[];
  if (workflowId) {
    rows = db.prepare(
      `SELECT s.* FROM sessions s
       JOIN workflow_sessions ws ON s.id = ws.session_id
       WHERE ws.workflow_id = ?
       ORDER BY s.started_at DESC`
    ).all(workflowId) as Record<string, unknown>[];
  } else {
    rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Record<string, unknown>[];
  }

  return rows.map((row) => ({
    id: row.id as string,
    workflowName: row.workflow_name as string,
    url: row.url as string,
    startedAt: row.started_at as number,
    endedAt: row.ended_at as number,
    domEvents: JSON.parse(row.dom_events as string),
    networkEvents: JSON.parse(row.network_events as string),
    correlations: JSON.parse(row.correlations as string),
  }));
}

// ---- Workflow Methods ----

export function createWorkflow(workflow: Partial<Workflow> & { name: string }): Workflow {
  const id = workflow.id || generateId();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO workflows (id, name, site_pattern, definition, mcp_server_path, mcp_server_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workflow.name,
    workflow.sitePattern || '',
    workflow.definition ? JSON.stringify(workflow.definition) : null,
    workflow.mcpServerPath || null,
    workflow.mcpServerStatus || 'stopped',
    now,
    now
  );

  return getWorkflow(id)!;
}

export function getWorkflow(id: string): Workflow | null {
  const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  // Get associated session IDs
  const sessionRows = db.prepare(
    'SELECT session_id FROM workflow_sessions WHERE workflow_id = ?'
  ).all(id) as { session_id: string }[];

  return {
    id: row.id as string,
    name: row.name as string,
    sitePattern: row.site_pattern as string,
    sessions: sessionRows.map((r) => r.session_id),
    definition: row.definition ? JSON.parse(row.definition as string) as WorkflowDefinition : undefined,
    mcpServerPath: (row.mcp_server_path as string) || undefined,
    mcpServerStatus: (row.mcp_server_status as 'stopped' | 'running' | 'error') || 'stopped',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getWorkflows(): Workflow[] {
  const rows = db.prepare('SELECT id FROM workflows ORDER BY updated_at DESC').all() as { id: string }[];
  return rows.map((row) => getWorkflow(row.id)!).filter(Boolean);
}

export function updateWorkflow(
  id: string,
  updates: Partial<{
    name: string;
    sitePattern: string;
    definition: WorkflowDefinition;
    mcpServerPath: string;
    mcpServerStatus: 'stopped' | 'running' | 'error';
  }>
): Workflow | null {
  const existing = getWorkflow(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.sitePattern !== undefined) {
    fields.push('site_pattern = ?');
    values.push(updates.sitePattern);
  }
  if (updates.definition !== undefined) {
    fields.push('definition = ?');
    values.push(JSON.stringify(updates.definition));
  }
  if (updates.mcpServerPath !== undefined) {
    fields.push('mcp_server_path = ?');
    values.push(updates.mcpServerPath);
  }
  if (updates.mcpServerStatus !== undefined) {
    fields.push('mcp_server_status = ?');
    values.push(updates.mcpServerStatus);
  }

  if (fields.length === 0) return existing;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE workflows SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  return getWorkflow(id);
}

export function deleteWorkflow(id: string): boolean {
  const existing = getWorkflow(id);
  if (!existing) return false;

  // Delete associated sessions
  const sessionIds = existing.sessions;
  for (const sessionId of sessionIds) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  // Junction table entries are deleted via CASCADE, but be explicit
  db.prepare('DELETE FROM workflow_sessions WHERE workflow_id = ?').run(id);

  // Delete the workflow
  db.prepare('DELETE FROM workflows WHERE id = ?').run(id);

  return true;
}

// ---- Config Methods ----

export function setConfig(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)'
  ).run(key, value);
}

export function getConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

// ---- Playback Log Methods ----

export function savePlaybackLog(entry: PlaybackLogEntry): void {
  const id = generateId();
  db.prepare(
    `INSERT INTO playback_logs (id, workflow_id, site_pattern, timestamp, data, outcome, insights)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    entry.workflowId,
    entry.sitePattern,
    entry.timestamp,
    JSON.stringify({ actions: entry.actions, totalActions: entry.totalActions, successfulActions: entry.successfulActions }),
    entry.outcome,
    entry.insights ?? null
  );
}

export function getPlaybackLogs(workflowId: string, limit?: number): PlaybackLogEntry[] {
  const sql = limit
    ? 'SELECT * FROM playback_logs WHERE workflow_id = ? ORDER BY timestamp DESC LIMIT ?'
    : 'SELECT * FROM playback_logs WHERE workflow_id = ? ORDER BY timestamp DESC';
  const rows = (limit
    ? db.prepare(sql).all(workflowId, limit)
    : db.prepare(sql).all(workflowId)) as Record<string, unknown>[];

  return rows.map((row) => {
    const data = JSON.parse(row.data as string);
    return {
      workflowId: row.workflow_id as string,
      sitePattern: row.site_pattern as string,
      timestamp: row.timestamp as number,
      actions: data.actions ?? [],
      outcome: row.outcome as 'completed' | 'failed' | 'partial',
      totalActions: data.totalActions ?? 0,
      successfulActions: data.successfulActions ?? 0,
      insights: (row.insights as string) || undefined,
    };
  });
}

export function getPlaybackInsights(sitePattern: string): string[] {
  const rows = db.prepare(
    `SELECT insights FROM playback_logs
     WHERE site_pattern = ? AND insights IS NOT NULL AND insights != ''
     ORDER BY timestamp DESC
     LIMIT 10`
  ).all(sitePattern) as { insights: string }[];
  return rows.map((r) => r.insights);
}

// ---- Utility ----

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

export function getDatabasePath(): string {
  return DB_PATH;
}

export function getMcpmakerDir(): string {
  return MCPMAKER_DIR;
}
