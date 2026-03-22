#!/usr/bin/env node
import { createServer } from './server.js';
import { indexProject } from './indexer/indexer.js';
import { generatePolicy } from './policy.js';
import { execSync } from 'child_process';

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'scan' || args[0] === 'init') {
    const path = args[1] || process.cwd();
    console.log(`Indexing ${path}...`);
    const result = await indexProject(path);
    console.log(`Done. ${result.indexedFiles} files indexed, ${result.skippedFiles} skipped, ${result.errors} errors in ${(result.duration / 1000).toFixed(1)}s`);
    process.exit(0);
  }

  if (args[0] === 'policy') {
    console.log(generatePolicy());
    process.exit(0);
  }

  if (args[0] === 'setup') {
    try {
      execSync('claude mcp remove omnidex 2>/dev/null || true', { stdio: 'inherit' });
      execSync('claude mcp add omnidex -- omnidex', { stdio: 'inherit' });
      console.log('Omnidex registered with Claude Code.');
    } catch (err) {
      console.error('Failed to register. Make sure Claude Code CLI is installed.');
      process.exit(1);
    }
    process.exit(0);
  }

  // Default: start MCP server
  const server = createServer();
  await server.start();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
