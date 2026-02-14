# MCPMAKER Database Schema

SQLite database at `~/.mcpmaker/mcpmaker.db` via `better-sqlite3`.

WAL mode enabled. Foreign keys enforced.

## Tables

### sessions
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Generated ID |
| workflow_id | TEXT | FK to workflows |
| workflow_name | TEXT NOT NULL | |
| url | TEXT NOT NULL | Recording URL |
| started_at | INTEGER NOT NULL | Unix timestamp |
| ended_at | INTEGER NOT NULL | Unix timestamp |
| dom_events | TEXT DEFAULT '[]' | JSON array of DOMEvent |
| network_events | TEXT DEFAULT '[]' | JSON array of NetworkEvent |
| correlations | TEXT DEFAULT '[]' | JSON array of Correlation |
| created_at | TEXT | datetime('now') |

**Index:** `idx_sessions_workflow_id` on `workflow_id`

### workflows
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Generated ID |
| name | TEXT NOT NULL | User-facing name |
| site_pattern | TEXT DEFAULT '' | Hostname for site matching |
| definition | TEXT | JSON WorkflowDefinition |
| mcp_server_path | TEXT | Path to generated server |
| mcp_server_status | TEXT DEFAULT 'stopped' | stopped/running/error |
| created_at | TEXT | datetime('now') |
| updated_at | TEXT | datetime('now') |

### workflow_sessions
Junction table linking workflows to sessions.

| Column | Type | Notes |
|--------|------|-------|
| workflow_id | TEXT NOT NULL | FK to workflows (CASCADE) |
| session_id | TEXT NOT NULL | FK to sessions (CASCADE) |

**PK:** (workflow_id, session_id)

### config
Key-value store for settings (e.g., `anthropic_api_key`).

| Column | Type |
|--------|------|
| key | TEXT PK |
| value | TEXT NOT NULL |

### playback_logs
Stores playback run history for learning over time.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | Generated ID |
| workflow_id | TEXT NOT NULL | |
| site_pattern | TEXT DEFAULT '' | For cross-workflow insights |
| timestamp | INTEGER NOT NULL | When the run happened |
| data | TEXT DEFAULT '{}' | JSON: actions, totalActions, successfulActions |
| outcome | TEXT DEFAULT 'partial' | completed/failed/partial |
| insights | TEXT | Claude-generated summary of what worked |

**Indexes:** `idx_playback_logs_workflow`, `idx_playback_logs_site`

## ID Generation

IDs use `Date.now().toString(36) + random` for URL-safe, sortable identifiers.
