import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { privateIngress } from './ingress.mjs';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

test('private bridge forwards API bodies and SSE chunks, and ignores spoofed caller headers', async () => {
  let forwarded = 0;
  const backend = http.createServer(async (req, res) => {
    forwarded++;
    if (req.url === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: last\n\n'), 100);
      return;
    }
    let body = ''; for await (const chunk of req) body += chunk;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ path: req.url, body, method: req.method }));
  });
  const backendPort = await listen(backend);
  const bridge = privateIngress({ upstreamPort: backendPort, allowedClients: ['127.0.0.1'] });
  const denied = privateIngress({ upstreamPort: backendPort, allowedClients: ['192.168.1.14'] });
  const port = await listen(bridge), deniedPort = await listen(denied);
  try {
    const result = await fetch(`http://127.0.0.1:${port}/api/ingest/conversation`, { method: 'POST', body: 'payload' });
    assert.deepEqual(await result.json(), { path: '/api/ingest/conversation', body: 'payload', method: 'POST' });
    const stream = await fetch(`http://127.0.0.1:${port}/api/stream`);
    const reader = stream.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: last\n\n');
    assert.equal((await fetch(`http://127.0.0.1:${deniedPort}/api/health`, { headers: { 'X-Forwarded-For': '192.168.1.14' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/other`)).status, 404);
    assert.equal(forwarded, 2);
  } finally { await close(bridge); await close(denied); await close(backend); }
});

test('storage commands route to the authenticated gateway while report APIs keep their upstream', async () => {
  const report = http.createServer((req,res) => { res.end('report:'+req.url); });
  const storage = http.createServer((req,res) => { res.end('storage:'+req.url+':'+req.headers.authorization); });
  const reportPort=await listen(report), storagePort=await listen(storage);
  const bridge=privateIngress({upstreamPort:reportPort,storageUpstreamPort:storagePort,allowedClients:['127.0.0.1']});
  const port=await listen(bridge);
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/api/storage/command`,{method:'POST',headers:{Authorization:'Bearer test-token'}})).text(),'storage:/command:Bearer test-token');
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/api/health`)).text(),'report:/api/health');
  } finally { await close(bridge);await close(storage);await close(report); }
});
