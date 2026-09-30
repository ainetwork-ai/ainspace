import { test } from 'node:test';
import assert from 'node:assert/strict';
import taskRef from './__fixtures__/task-ref.json';
import {
  buildInvokeBody, canUseVillageMaterials, cancelTurn, isActive, newAskConversationId, newTurnId, placedAskTargets, retryTurn, runTurn, sourceItems, startTurn,
  type AskFetcher, type AskInput,
} from './ask-client';
import { REQUEST_ID_RE } from './invoke';
import { AIN_CONTRACT_VERSION, fileKey, type FileRef, type TaskRef } from './types';

const ref = (id: string, sourceUrl = `https://aindrive.example/d/drv/${id}.md`): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: 'https://aindrive.example', driveId: 'drv', fileId: `p1:${id}`, revision: 'r', kind: 'file', displayName: `${id}.md`,
  ownerRef: { kind: 'principal', issuer: 'https://aindrive.example', subject: 'o' }, availability: { state: 'online' }, sourceUrl,
});
const placed = { agentKey: 'https://ainize.example#guide', name: '안내', placedIn: 'alpha' };
const shared = { agentKey: 'https://ainize.example#doc-summary', name: '문서 요약', placedIn: null };
const input = (o: Partial<AskInput> = {}): AskInput => ({ target: placed, text: '  요약해 줘 ', files: [ref('a'), ref('a'), ref('b')], conversation: 'ask_1', room: 'alpha', villageMaterials: true, ...o });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function recorder(respond: (body: Record<string, unknown>, n: number) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = [];
  const f: AskFetcher = async (url, init) => { const body = JSON.parse(String(init?.body)); calls.push({ url, init, body }); return respond(body, calls.length); };
  return { f, calls };
}

test('차례 id·대화 id 는 invoke 가 받는 모양이고 매번 다르다', () => {
  const a = newTurnId(); const b = newTurnId();
  assert.match(a, REQUEST_ID_RE); assert.notEqual(a, b);
  assert.match(newAskConversationId(), /^ask_[^\s/\\]+$/);
});

test('바디: 텍스트 trim, fileKeys 중복 제거, room, 마을 자료는 그 마을에 배치된 에이전트일 때만', () => {
  const b = buildInvokeBody(input(), 'turn_1');
  assert.deepEqual(b, { agentKey: placed.agentKey, text: '요약해 줘', fileKeys: [fileKey(ref('a')), fileKey(ref('b'))], conversation: 'ask_1', requestId: 'turn_1', room: 'alpha', villageMaterials: true });
  assert.ok(!('villageMaterials' in buildInvokeBody(input({ target: shared }), 't')), '배치되지 않은 공유 에이전트에게는 마을 자료를 싣지 않는다');
  assert.ok(!('villageMaterials' in buildInvokeBody(input({ room: 'beta' }), 't')), '다른 마을');
  const outside = buildInvokeBody(input({ room: null, files: [] }), 't');
  assert.ok(!('room' in outside) && !('villageMaterials' in outside));
  assert.deepEqual(outside.fileKeys, []);
  assert.equal(canUseVillageMaterials(placed, 'alpha'), true);
  assert.equal(canUseVillageMaterials(null, 'alpha'), false);
});

test('성공: POST /api/ain/invoke → 완료 카드 상태 + 답 + Sources(http(s) 링크만, 인용)', async () => {
  const { f, calls } = recorder(() => json({ task: taskRef, text: '개관은 10:00' }));
  const turn = startTurn(input(), 'turn_ok');
  assert.equal(turn.phase, 'pending');
  assert.ok(isActive(turn));
  const done = await runTurn(f, turn);
  assert.equal(calls[0].url, '/api/ain/invoke');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal(calls[0].body.requestId, 'turn_ok');
  assert.equal(done.phase, 'completed');
  assert.equal(done.text, '개관은 10:00');
  assert.ok(!isActive(done));
  const src = sourceItems(done.task);
  assert.equal(src.length, 1);
  assert.equal(src[0].name, '전시 안내.pdf');
  assert.equal(src[0].href, (taskRef as TaskRef).sources[0].file.sourceUrl);
  assert.deepEqual(src[0].citations, ['page 2 — 개관 10:00']);

  const evil = { ...taskRef, sources: [{ file: ref('x', 'javascript:alert(1)'), citations: [] }] } as TaskRef;
  assert.equal(sourceItems(evil)[0].href, null);
});

test('오류: 계약 바디(코드·문장·재시도·http(s) actionUrl) → 실패 카드; 네트워크 오류는 재시도 가능', async () => {
  const auth = await runTurn(recorder(() => json({ error: { code: 'auth_required', message: 'AIN SSO 연결 필요', retryable: false, actionUrl: 'https://teams.example/settings/ain-sso' } }, 401)).f, startTurn(input(), 't1'));
  assert.equal(auth.phase, 'failed');
  assert.deepEqual(auth.error, { code: 'auth_required', message: 'AIN SSO 연결 필요', retryable: false, actionUrl: 'https://teams.example/settings/ain-sso' });
  const js = await runTurn(recorder(() => json({ error: { code: 'auth_required', message: 'x', retryable: false, actionUrl: 'javascript:alert(1)' } }, 401)).f, startTurn(input(), 't2'));
  assert.equal(js.error?.actionUrl, undefined);
  const down = await runTurn(async () => { throw new TypeError('fetch failed'); }, startTurn(input(), 't3'));
  assert.equal(down.error?.code, 'network');
  assert.equal(down.error?.retryable, true);
  const failedTask = await runTurn(recorder(() => json({ task: { ...taskRef, status: 'failed', sources: [], error: { code: 'temporary_failure', message: '에이전트 실패', retryable: true } }, text: '' })).f, startTurn(input(), 't4'));
  assert.equal(failedTask.phase, 'failed');
  assert.equal(failedTask.error?.message, '에이전트 실패');
});

test('취소: 진행 중 요청을 끊으면 canceled(결과는 버린다); 다시 시도는 같은 requestId·같은 바디, 새 차례는 새 requestId', async () => {
  let release: (r: Response) => void = () => {};
  const { f, calls } = recorder((_b, n) => (n === 1 ? new Promise<Response>((ok, no) => {
    release = ok;
    calls[0].init?.signal?.addEventListener('abort', () => no(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) : json({ task: taskRef, text: '답' })));
  const turn = startTurn(input(), 'turn_c');
  const ctl = new AbortController();
  const pending = runTurn(f, turn, ctl.signal);
  ctl.abort();
  release(json({ task: taskRef, text: '늦은 답' }));
  const canceled = await pending;
  assert.equal(canceled.phase, 'canceled');
  assert.equal(canceled.text, undefined);
  assert.equal(canceled.error?.retryable, true);
  assert.equal(cancelTurn(turn).phase, 'canceled');

  const again = retryTurn(canceled);
  assert.equal(again.phase, 'pending');
  assert.equal(again.error, undefined);
  const done = await runTurn(f, again);
  assert.equal(done.phase, 'completed');
  assert.equal(calls[1].body.requestId, 'turn_c');
  assert.deepEqual(calls[1].body, calls[0].body);

  const next = startTurn(input());
  assert.notEqual(next.requestId, 'turn_c');
});

test('배치된 공유 에이전트: 이 마을·commonAgentId 있는 것만, agentKey 로 중복 제거, 마을 밖은 없음', () => {
  const agents = [
    { name: '안내', commonAgentId: placed.agentKey, mapName: 'alpha' },
    { name: '안내(복제)', commonAgentId: placed.agentKey, mapName: 'alpha' },
    { name: 'URL 로 가져온 것', mapName: 'alpha' },
    { name: '다른 마을', commonAgentId: 'https://ainize.example#other', mapName: 'beta' },
  ];
  assert.deepEqual(placedAskTargets(agents, 'alpha'), [placed]);
  assert.deepEqual(placedAskTargets(agents, null), []);
});
