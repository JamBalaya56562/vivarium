#!/usr/bin/env node

import { runServer } from './server.js';

runServer().catch((err: unknown) => {
  console.error('vivarium-mcp: fatal:', err);
  process.exit(1);
});
