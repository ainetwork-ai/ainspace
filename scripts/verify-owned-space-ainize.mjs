// Run on the owned Ainize server only. Outputs status, never prompts/responses/keys.
import assert from 'node:assert/strict';
import inference from '../src/lib/ainize-inference.ts';
if (process.platform !== 'linux' || process.env.AINSPACE_OWNED_AI_VERIFY !== 'true') throw new Error('Owned remote verification only');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { key } = JSON.parse(input);
process.env.AINIZE_URL = 'http://127.0.0.1:3402';
process.env.AINIZE_API_KEY = key;
process.env.AINIZE_CHAT_MODEL = 'Qwen3.8-Flash-Next';
const direct = await inference.generateAinizeText('For an owned service connectivity test, reply with one short greeting in Korean.');
assert.ok(direct.trim().length > 0);
console.log(JSON.stringify({ directAinizeText: true }));
const request = (path, body) => fetch(`http://127.0.0.1:17930${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
});
const commentary = await request('/api/commentary', { gameState: { worldPosition: { x: 1, y: 2 }, currentTerrain: 'grass', visibleAgents: [], recentMovements: ['down'], biome: 'plains' } });
assert.equal(commentary.status, 200);
const commentaryResult = await commentary.json();
assert.equal(typeof commentaryResult.commentary, 'string');
assert.ok(commentaryResult.commentary.trim());
assert.ok(!['Continuing my autonomous exploration through this mysterious world...', 'The journey continues, one tile at a time.', 'Wandering through the infinite expanse, discovering new territories.', 'Each step reveals more of this procedurally generated universe.', 'The autonomous explorer presses on through unknown lands.'].includes(commentaryResult.commentary));
console.log(JSON.stringify({ commentaryViaOwnedAinize: true }));
const agent = await request('/api/agent-response', { agentData: { name: 'Owned Verifier', behavior: 'explorer', position: { x: 2, y: 3 }, playerPosition: { x: 1, y: 2 }, distance: 1.4, userMessage: 'Hello, let us explore together.', isMentioned: true } });
assert.equal(agent.status, 200);
const agentResult = await agent.json();
assert.equal(typeof agentResult.response, 'string');
assert.ok(agentResult.response.trim());
assert.ok(!agentResult.response.startsWith('Agent Owned Verifier received your message'));
const image = await request('/api/convert-image', {});
assert.equal(image.status, 503);
console.log(JSON.stringify({ agentResponseViaOwnedAinize: true, missingEditDeploymentReturnsUnavailableBeforeJob: true, localInference: false }));
