import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, createAnalysisService } from './server/analysis.mjs';

const rootDirectory = dirname(fileURLToPath(import.meta.url));
export const MAX_REQUEST_BYTES = 750000;

function reply(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw new AppError(415, 'JSON_REQUIRED', '请求必须使用 JSON 格式。');
  if (Number(request.headers['content-length'] || 0) > MAX_REQUEST_BYTES) throw new AppError(413, 'REQUEST_TOO_LARGE', '请求过大，请拆分文档后重试。');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new AppError(413, 'REQUEST_TOO_LARGE', '请求过大，请拆分文档后重试。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'INVALID_JSON', '请求内容不是有效的 JSON。'); }
}

export function createAppServer({ service = createAnalysisService(), root = rootDirectory } = {}) {
  const server = http.createServer(async (request, response) => {
    try {
      const port = server.address()?.port;
      const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
      const host = request.headers.host;
      const origin = request.headers.origin;
      if (!hosts.has(host) || (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin))) throw new AppError(403, 'LOCAL_ACCESS_ONLY', '仅允许从本机工作台访问。');
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/config') return reply(response, 200, service.getConfig());
        if (!origin) throw new AppError(403, 'ORIGIN_REQUIRED', '请通过本机工作台发起操作。');
        if (request.method === 'DELETE' && url.pathname === '/api/config') return reply(response, 200, service.clearConfig());
        if (request.method === 'POST') {
          const body = await readJson(request);
          if (url.pathname === '/api/config') return reply(response, 200, service.setConfig(body));
          if (url.pathname === '/api/test' || url.pathname === '/api/config/test') return reply(response, 200, await service.testConnection());
          if (url.pathname === '/api/analyze') return reply(response, 200, await service.analyze(body));
        }
        throw new AppError(404, 'NOT_FOUND', '接口不存在。');
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new AppError(405, 'METHOD_NOT_ALLOWED', '不支持此操作。');
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!(relative === 'index.html' || /^src\/[a-zA-Z0-9._-]+\.(?:js|css)$/.test(relative) || relative === 'vendor/jszip.min.js')) throw new AppError(404, 'NOT_FOUND', '文件不存在。');
      let file;
      try {
        file = await realpath(resolve(root, relative));
        if (!file.startsWith(`${resolve(root)}${sep}`)) throw new Error();
      } catch { throw new AppError(404, 'NOT_FOUND', '文件不存在。'); }
      const data = await readFile(file);
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!response.headersSent) reply(response, error instanceof AppError ? error.status : 500, { error: { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR', message: error instanceof AppError ? error.message : '本地服务处理失败，请重试。' } });
      else response.end();
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('PORT 必须是 1024 到 65535 的整数。'); process.exitCode = 1; }
  else {
    const server = createAppServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用：请关闭已有工作台服务，或使用其他 PORT。' : '本地服务未能启动。'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`China wertigate 已启动：http://127.0.0.1:${port}`));
  }
}
