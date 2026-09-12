import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { createAnalysisService } from '../server/analysis.mjs';

test('production config is environment managed and never accepts browser keys', async t => {
  const env = { VERCEL: '1', NODE_ENV: 'production', VERCEL_URL: 'china-wertigate.vercel.app', DEEPSEEK_API_KEY: 'test-only-env-key', DEEPSEEK_MODEL: 'deepseek-flash' };
  const service = createAnalysisService({ env, fetchImpl: async () => { throw new Error('network not expected'); } });
  assert.equal(service.getConfig().configured, true);
  assert.equal(service.getConfig().managed, true);
  assert.equal(Object.hasOwn(service.getConfig(), 'apiKey'), false);
  assert.throws(() => service.setConfig({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'browser-key' }), error => error.code === 'CONFIG_MANAGED_BY_ENV');
  assert.throws(() => service.clearConfig(), error => error.code === 'CONFIG_MANAGED_BY_ENV');

  const server = createAppServer({ service, env });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const request = (path, options = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    ...options,
    headers: { 'x-forwarded-host': 'china-wertigate.vercel.app', Origin: 'https://china-wertigate.vercel.app', ...(options.headers || {}) }
  });
  const config = await request('/api/config');
  assert.equal(config.status, 200);
  const configText = await config.text();
  assert.equal(configText.includes('test-only-env-key'), false);
  assert.equal(configText.includes('apiKey'), false);
  const attempted = await request('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-flash', apiKey: 'browser-key' }) });
  assert.equal(attempted.status, 403);
  assert.equal((await attempted.json()).error.code, 'CONFIG_MANAGED_BY_ENV');
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/src/platform.js')).status, 200);
  assert.equal((await request('/server/analysis.mjs')).status, 404);
  assert.equal((await request('/api/config', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
});

test('production host and origin checks reject untrusted requests', async t => {
  const env = { VERCEL: '1', NODE_ENV: 'production', VERCEL_URL: 'china-wertigate.vercel.app' };
  const service = createAnalysisService({ env, fetchImpl: async () => { throw new Error('network not expected'); } });
  const server = createAppServer({ service, env });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const request = (headers) => fetch(`http://127.0.0.1:${port}/`, { headers });
  assert.equal((await request({ 'x-forwarded-host': 'evil.example', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request({ 'x-forwarded-host': 'china-wertigate.vercel.app', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request({ 'x-forwarded-host': 'china-wertigate.vercel.app' })).status, 200);
});
