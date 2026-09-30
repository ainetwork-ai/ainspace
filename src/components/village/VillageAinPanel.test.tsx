import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import VillageAinPanel, { ExhibitList, MembersSection } from './VillageAinPanel';
import { AIN_CONTRACT_VERSION, type FileRef } from '@/lib/ain-integration/types';
import type { ExhibitItem } from '@/lib/ain-integration/village-client';
import { withEnv } from '@/lib/ain-integration/__tests__/helpers';

const ref = (id: string): FileRef => ({
  contract: AIN_CONTRACT_VERSION, issuer: 'https://aindrive.example', driveId: 'd', fileId: `p1:${id}`, revision: 'r', kind: 'file', displayName: `${id}.png`,
  ownerRef: { kind: 'principal', issuer: 'https://aindrive.example', subject: 'a' }, availability: { state: 'online' }, sourceUrl: `https://aindrive.example/d/d/${id}.png`,
});
const item = (id: string, availability: ExhibitItem['availability'], audience: ExhibitItem['audience'] = 'public'): ExhibitItem => ({ ref: ref(id), audience, addedAt: 'x', availability });

test('플래그 off·마을 밖·로그아웃 → 렌더링하지 않는다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, () => {
  assert.equal(renderToStaticMarkup(<VillageAinPanel slug="alpha" loggedIn />), '');
  assert.equal(renderToStaticMarkup(<VillageAinPanel slug={null} loggedIn enabled />), '');
  assert.equal(renderToStaticMarkup(<VillageAinPanel slug="alpha" loggedIn={false} enabled />), '');
}));

test('플래그 on → 마을 안에서 "전시·마을" 진입점이 보인다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  const html = renderToStaticMarkup(<VillageAinPanel slug="alpha" loggedIn />);
  assert.ok(html.includes('data-testid="village-ain-panel"'));
  assert.ok(html.includes('전시·마을'));
}));

test('전시 목록: 열 수 있는 것만 링크, 삭제됨·볼 수 없음·오프라인·확인 불가 배지, 멤버 전용 표시, 소유자만 빼기 버튼', () => {
  const items = [item('ok', 'available'), item('gone', 'deleted'), item('nope', 'forbidden'), item('off', 'offline'), item('unk', 'unknown'), item('mem', 'available', 'members')];
  const html = renderToStaticMarkup(<ExhibitList items={items} isOwner={false} />);
  assert.ok(html.includes('href="https://aindrive.example/d/d/ok.png"'));
  assert.ok(!html.includes('href="https://aindrive.example/d/d/gone.png"'));
  assert.ok(!html.includes('href="https://aindrive.example/d/d/off.png"'));
  for (const label of ['삭제됨', '볼 수 없음', '오프라인', '확인 불가', '멤버']) assert.ok(html.includes(label), label);
  for (const a of ['available', 'deleted', 'forbidden', 'offline', 'unknown']) assert.ok(html.includes(`data-availability="${a}"`), a);
  assert.ok(!html.includes('전시에서 빼기'));
  const owner = renderToStaticMarkup(<ExhibitList items={items} isOwner onRemove={() => {}} />);
  assert.ok(owner.includes('ok.png 전시에서 빼기'));
});

test('멤버 관리: 소유자는 "소유자" 표시(빼기 없음), 다른 멤버는 빼기 버튼, 추가 입력', () => {
  const html = renderToStaticMarkup(<MembersSection view={{ owner: 'owner-1', members: ['member-2', 'owner-1'] }} onAdd={() => {}} onRemove={() => {}} />);
  assert.ok(html.includes('data-testid="village-members"'));
  assert.ok(html.includes('member-2 멤버에서 빼기'));
  assert.ok(!html.includes('owner-1 멤버에서 빼기'));
  assert.ok(html.includes('소유자'));
  assert.ok(html.includes('추가할 멤버의 사용자 id'));
});
