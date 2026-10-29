import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { createStreamDispatcher } from './stream-dispatcher';

const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

/** A backend that answers with an SSE line, and a proxy that records which hosts it tunnelled to. */
async function fixtures(t: { after: (fn: () => void) => void }) {
  const backend = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: {"type":"message"}\n\n'); });
  // Tunnels like the sandbox egress proxy: CONNECT host:port, then raw bytes both ways.
  const relayed: string[] = [];
  const tunnels: Socket[] = [];
  const proxy = createServer((_req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connect', (req, client: Socket, head: Buffer) => {
    relayed.push(req.url ?? '');
    const [host, port] = (req.url ?? '').split(':');
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head); upstream.pipe(client); client.pipe(upstream);
    });
    tunnels.push(client, upstream);
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy());
  });
  const backendUrl = await listen(backend);
  const proxyUrl = await listen(proxy);
  t.after(() => { tunnels.forEach(s => s.destroy()); for (const s of [backend, proxy]) { s.closeAllConnections(); s.close(); } });
  return { backendUrl, proxyUrl, relayed };
}

// On Ainize egress only leaves through the sandbox proxy; a dispatcher that ignored it never connected (2026-10-29).
test('the stream goes through the configured egress proxy', async t => {
  const { backendUrl, proxyUrl, relayed } = await fixtures(t);
  const dispatcher = createStreamDispatcher({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: '' });
  t.after(() => dispatcher.close());
  const res = await fetch(`${backendUrl}/orchestration/dm/c1/stream`, { dispatcher } as RequestInit);
  assert.equal(await res.text(), 'data: {"type":"message"}\n\n');
  assert.deepEqual(relayed, [new URL(backendUrl).host]);
});

test('without proxy variables it connects directly, and NO_PROXY hosts bypass the proxy', async t => {
  const { backendUrl, proxyUrl, relayed } = await fixtures(t);
  const direct = createStreamDispatcher({ httpProxy: '', httpsProxy: '', noProxy: '' });
  const bypass = createStreamDispatcher({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: '127.0.0.1' });
  t.after(() => { direct.close(); bypass.close(); });
  for (const dispatcher of [direct, bypass]) {
    const res = await fetch(`${backendUrl}/s`, { dispatcher } as RequestInit);
    assert.equal(res.status, 200);
    await res.text();
  }
  assert.deepEqual(relayed, []);
});
