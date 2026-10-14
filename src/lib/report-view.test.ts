import test from 'node:test';
import assert from 'node:assert/strict';
import { reportTopicPreview } from './report-view';
import { getTopicClaims, type Claim, type Topic } from '@/types/report';
const claim: Claim = { id: 'claim', speaker: 'person', title: 'Claim', number: 1, similarClaims: [], stance: 'support', confidence: 1, evolved: false,
  quotes: [{ id: 'quote', text: 'Full quote remains visible in the overview tooltip', reference: { id: 'ref', sourceId: 'source', segmentId: 'segment', messageId: 'message' } }],
  context: [{ id: 'context', speaker: 'person', content: 'Conversation details loaded only on expansion'.repeat(500), timestamp: 1, isUser: true }] };
const topic: Topic = { id: 'topic', name: 'topic', title: 'Topic', description: 'Summary', messageCount: 1, percentage: 100,
  sentiment: { overall: 'positive', distribution: { positive: 1, negative: 0, neutral: 0 } }, opinions: [], messages: [], summary: { text: 'Overview' }, position: { x: 0, y: 0 }, color: '#123456',
  subtopics: [{ id: 'subtopic', title: 'Subtopic', claims: [claim, { ...claim, id: 'second-claim' }] }] };
test('overview preserves quote tooltips and deduplicates message identities across claims', () => {
  const preview = reportTopicPreview(topic);
  assert.equal(preview.messages.length, 1);
  assert.equal(preview.messages[0].content, claim.quotes[0].text);
  assert.equal(preview.messages[0].sentiment, 'positive');
  assert.equal(preview.subtopics?.[0].title, 'Subtopic');
});
test('claim conversations are absent from the initial payload and the full source remains intact', () => {
  const before = JSON.stringify(topic); const preview = reportTopicPreview(topic);
  assert.equal(getTopicClaims(preview).length, 0);
  assert.equal(getTopicClaims(topic).length, 2);
  assert.equal(JSON.stringify(topic), before);
  assert.ok(JSON.stringify(preview).length < before.length / 10);
});
test('legacy topic messages and flat claim quotes remain supported', () => {
  const flat = { ...topic, subtopics: undefined, claims: [claim] };
  assert.equal(reportTopicPreview(flat).messages[0].id, 'message');
  const messages = [{ ...reportTopicPreview(flat).messages[0], content: 'Original topic message', timestamp: 99 }];
  assert.equal(reportTopicPreview({ ...flat, messages }).messages, messages);
});
