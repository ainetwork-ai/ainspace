import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAgentsByUrls } from './agents-by-url';

test('small and large chat groups read only their unique selected records in one request', async () => {
    for (const count of [1, 2, 5, 20]) {
        const urls = Array.from({ length: count }, (_, i) => `https://ainize.ai/agents/agent-${i}`);
        let calls = 0;
        const agents = await readAgentsByUrls({
            async mGet(keys) {
                calls++;
                assert.deepEqual(keys, urls.map((url) => `agents:${Buffer.from(url).toString('base64')}`));
                return keys.map((key, i) => JSON.stringify({
                    url: Buffer.from(key.slice(7), 'base64').toString(), card: { name: `Agent ${i}` }, timestamp: i,
                }));
            },
        }, [...urls, urls[0]!]);
        assert.equal(calls, 1);
        assert.equal(agents.length, count);
        assert.equal(agents[0]!.url, urls[count - 1]);
    }
});

test('card aliases retain exact identity; missing records do not become new participants', async () => {
    const urls = ['https://ainize.ai/agents/a/.well-known/agent.json', 'https://ainize.ai/agents/a'];
    const result = await readAgentsByUrls({
        async mGet(keys) {
            assert.equal(Buffer.from(keys[0]!.slice(7), 'base64').toString(), urls[0]);
            return [JSON.stringify({ url: urls[0], card: { name: 'A' }, timestamp: 1 }), null];
        },
    }, urls);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.url, urls[0]);
});

test('no selected agents requires no AIN storage connection or read', async () => {
    const result = await readAgentsByUrls({ async mGet() { throw new Error('must not read'); } }, []);
    assert.deepEqual(result, []);
});
