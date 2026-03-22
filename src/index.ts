#!/usr/bin/env node
import { createServer } from './server.js';

async function main() {
  const server = createServer();
  await server.start();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
