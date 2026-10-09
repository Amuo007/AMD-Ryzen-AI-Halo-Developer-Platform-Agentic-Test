import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeServer } from '../lib/server.js';
import { request } from 'node:http';
import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';

test('server serves index.html', async (t) => {
  let server;
  try {
    server = createForgeServer();
    const port = 0; // random free port
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const actualPort = server.address().port;
    const res = await new Promise((resolve, reject) => {
      const req = request({ port: actualPort, hostname: '127.0.0.1', path: '/', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.body, /<title>Forge - Coding Agent<\/title>/);
  } finally {
    if (server) server.close();
  }
});

test('server serves static css file', async (t) => {
  let server;
  try {
    const publicDir = resolve('./public');
    const cssPath = join(publicDir, 'test.css');
    await fs.writeFile(cssPath, 'body { color: red; }');
    server = createForgeServer();
    const port = 0;
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const actualPort = server.address().port;
    const res = await new Promise((resolve, reject) => {
      const req = request({ port: actualPort, hostname: '127.0.0.1', path: '/test.css', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'text/css');
    assert.strictEqual(res.body, 'body { color: red; }');
  } finally {
    // cleanup
    try {
      await fs.rm(join('./public', 'test.css'), { force: true });
    } catch (_) {}
    if (server) server.close();
  }
});

test('server returns 404 for unknown path', async (t) => {
  let server;
  try {
    server = createForgeServer();
    const port = 0;
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    const actualPort = server.address().port;
    const res = await new Promise((resolve, reject) => {
      const req = request({ port: actualPort, hostname: '127.0.0.1', path: '/unknown', method: 'GET' }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 404);
  } finally {
    if (server) server.close();
  }
});
