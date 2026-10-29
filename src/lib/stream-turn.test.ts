import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyDelta, applyFinalMessage, turnMessageId } from './stream-turn';
import type { ChatMessage } from '@/stores/useChatStore';

const user: ChatMessage = { id: 'u1', text: 'hi', timestamp: new Date(0), sender: 'user' };
const now = new Date(1000);

describe('applyDelta', () => {
    it('creates one provisional bubble per turn and then updates its text in place', () => {
        const first = applyDelta([user], { turnId: 't1', speaker: 'Bot', userId: 'bot-1', content: '안녕' }, 'thread-1', now);
        assert.equal(first.length, 2);
        assert.deepEqual(
            { ...first[1], timestamp: undefined },
            { id: turnMessageId('t1'), text: '안녕', timestamp: undefined, sender: 'ai', senderId: 'Bot', senderUserId: 'bot-1', threadId: 'thread-1', streaming: true },
        );
        const second = applyDelta(first, { turnId: 't1', content: '안녕하세요' }, 'thread-1', now);
        assert.equal(second.length, 2);
        assert.equal(second[1].text, '안녕하세요');
        assert.equal(second[1].id, first[1].id);
    });

    it('ignores malformed or empty deltas and returns the same array when nothing changes', () => {
        const list = [user];
        assert.equal(applyDelta(list, { content: 'x' }, 'thread-1', now), list);
        assert.equal(applyDelta(list, { turnId: 't', content: '' }, undefined, now), list);
        const withBubble = applyDelta(list, { turnId: 't', content: 'a' }, undefined, now);
        assert.equal(applyDelta(withBubble, { turnId: 't', content: 'a' }, undefined, now), withBubble);
    });
});

describe('applyFinalMessage', () => {
    const final: ChatMessage = { id: 'm1', text: '안녕하세요!', timestamp: now, sender: 'ai', senderId: 'Bot' };

    it('replaces the provisional bubble of the same turn in place', () => {
        const streaming = applyDelta([user], { turnId: 't1', speaker: 'Bot', content: '안녕' }, undefined, now);
        const done = applyFinalMessage(streaming, final, 't1');
        assert.deepEqual(done.map((m) => m.id), ['u1', 'm1']);
        assert.equal(done[1].text, '안녕하세요!');
    });

    it('appends when there was no delta (non-streaming agent) and never duplicates an id', () => {
        const once = applyFinalMessage([user], final, 't-unknown');
        assert.deepEqual(once.map((m) => m.id), ['u1', 'm1']);
        assert.equal(applyFinalMessage(once, final, 't-unknown'), once);
        assert.deepEqual(applyFinalMessage([user], final).map((m) => m.id), ['u1', 'm1']);
    });
});
