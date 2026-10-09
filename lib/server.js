import { createServer as httpCreateServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PUBLIC_DIR = resolve('./public');

async function serveFile(response, filePath, contentType = 'text/html') {
  try {
    await stat(filePath);
    const buffer = await Promise.resolve().then(() => import('node:fs')).then(fs => fs.promises.readFile(filePath));
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(buffer);
  } catch (err) {
    response.writeHead(404);
    response.end('Not Found');
  }
}

function createForgeServer() {
  return httpCreateServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(response, join(PUBLIC_DIR, 'index.html'), 'text/html');
    }

    // Serve static files from public/
    const filePath = join(PUBLIC_DIR, pathname);
    try {
      const stats = await stat(filePath);
      if (stats.isFile()) {
        let contentType = 'application/octet-stream';
        if (filePath.endsWith('.html')) contentType = 'text/html';
        else if (filePath.endsWith('.css')) contentType = 'text/css';
        else if (filePath.endsWith('.js')) contentType = 'application/javascript';
        else if (filePath.endsWith('.json')) contentType = 'application/json';
        else if (filePath.endsWith('.png')) contentType = 'image/png';
        else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) contentType = 'image/jpeg';
        else if (filePath.endsWith('.svg')) contentType = 'image/svg+xml';
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(await Promise.resolve().then(() => import('node:fs')).then(fs => fs.promises.readFile(filePath)));
        return;
      }
    } catch (err) {
      // Not a file or not found
    }

    response.writeHead(404);
    response.end('Not Found');
  });
}

export { createForgeServer };
export default { createForgeServer };
