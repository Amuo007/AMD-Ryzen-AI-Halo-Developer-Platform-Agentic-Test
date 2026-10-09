#!/usr/bin/env node
import { createForgeServer } from '../lib/server.js';
import { open } from 'node:child_process';
import { platform } from 'node:os';

const DEFAULT_PORT = 4848;
const HOST = '127.0.0.1';

function parseArgs(args) {
  const port = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      port.value = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return port;
}

function openBrowser(url) {
  try {
    if (platform === 'darwin') {
      open('open', [url]);
    } else if (platform === 'win32') {
      open('start', [url]);
    } else {
      open('xdg-open', [url]);
    }
  } catch (err) {
    console.warn('Could not open browser automatically:', err.message);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const portObj = parseArgs(args);
  const port = portObj.value || DEFAULT_PORT;

  const server = createForgeServer();

  server.listen(port, HOST, () => {
    console.log(`Server running at http://${HOST}:${port}/`);
    const url = `http://${HOST}:${port}/`;
    openBrowser(url);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Try a different port with --port <number>.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
