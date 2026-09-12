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

function cleanHost(value) { return String(value || '').trim().toLowerCase().replace(/\.$/, ''); }

function deploymentHosts(env) {
  return [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.PUBLIC_APP_HOST]
    .filter(Boolean).map(value => cleanHost(value).replace(/^https?:\/\//, '').split('/')[0]);
}

function isVercelHost(host) { return /^[a-z0-9][a-z0-9-]*\.vercel\.app(?::\d+)?$/.test(host); }

function requestHost(request) {
  const forwarded = request.headers['x-forwarded-host'];
  return cleanHost(Array.isArray(forwarded) ? forwarded[0] : forwarded || request.headers.host);
}

function requestOriginAllowed(origin, host, port, env) {
  if (!origin) return false;
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const originHost = cleanHost(parsed.host);
  const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, 'localhost', '127.0.0.1']);
  if (env.VERCEL !== '1' && env.NODE_ENV !== 'production') return parsed.protocol === 'http:' && localHosts.has(originHost);
  return parsed.protocol === 'https:' && (deploymentHosts(env).includes(originHost) || (originHost === host && isVercelHost(originHost)));
}

function hostAllowed(host, port, env) {
  const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, 'localhost', '127.0.0.1']);
  if (env.VERCEL !== '1' && env.NODE_ENV !== 'production') return localHosts.has(host);
  return deploymentHosts(env).includes(host) || isVercelHost(host);
}

async function handleRequest(request, response, { service, root, env, port }) {
  try {
    const host = requestHost(request);
    const origin = request.headers.origin;
    if (!hostAllowed(host, port, env) || (origin && !requestOriginAllowed(origin, host, port, env))) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', '请求来源未获允许。');
    const url = new URL(request.url, `${env.VERCEL === '1' ? 'https' : 'http'}://${host}`);
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'GET' && url.pathname === '/api/config') return reply(response, 200, service.getConfig());
      if (!origin || !requestOriginAllowed(origin, host, port, env)) throw new AppError(403, 'ORIGIN_REQUIRED', '请通过受信任的同源页面发起操作。');
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
}

export function createAppServer({ service = createAnalysisService(), root = rootDirectory, env = process.env } = {}) {
  const server = http.createServer((request, response) => handleRequest(request, response, { service, root, env, port: server.address()?.port }));
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
    server.listen(port, () => console.log(`China wertigate 已启动：http://127.0.0.1:${port}`));
  }
}

const vercelService = createAnalysisService({ env: process.env, allowClientConfig: false });
export default function vercelHandler(request, response) {
  return handleRequest(request, response, { service: vercelService, root: rootDirectory, env: process.env, port: undefined });
}
