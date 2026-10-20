#!/usr/bin/env node
// crashtest — in-process adversarial QA. Never opens a socket.
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch(err => {
  console.error('crashtest:', err.message);
  process.exit(1);
});
