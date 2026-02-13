// ============================================================
// MCPMAKER Engine - Entry Point
// Initializes database and starts the HTTP server
// ============================================================

import { initDatabase, getDatabasePath } from './database.js';
import { startServer } from './server.js';
import { ENGINE_PORT } from './types.js';

async function main(): Promise<void> {
  console.log('');
  console.log('  ┌─────────────────────────────────────────┐');
  console.log('  │           MCPMAKER Engine v0.1.0         │');
  console.log('  │   Record Once, Press Play as MCP Tool    │');
  console.log('  └─────────────────────────────────────────┘');
  console.log('');

  // Initialize database
  try {
    initDatabase();
    console.log(`  Database: ${getDatabasePath()}`);
  } catch (error) {
    console.error('Failed to initialize database:', (error as Error).message);
    process.exit(1);
  }

  // Start HTTP server
  try {
    await startServer();
    console.log(`  Server:   http://127.0.0.1:${ENGINE_PORT}`);
    console.log('');
    console.log('  Ready to receive recordings from the browser extension.');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
  } catch (error) {
    console.error('Failed to start server:', (error as Error).message);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\nShutting down MCPMAKER Engine...');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
