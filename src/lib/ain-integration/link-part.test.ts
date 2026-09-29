import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileLinkMarkdown, insertAtCursor } from './link-part';

test('fileLinkMarkdown: sourceUrl 이 있어야 링크 파트가 되고, 괄호·공백은 이스케이프한다', () => {
  assert.equal(fileLinkMarkdown({ displayName: '전시 안내.pdf', sourceUrl: 'https://a.example/d/x/전시 안내 (1).pdf' }), '[전시 안내.pdf](https://a.example/d/x/전시%20안내%20%281%29.pdf)');
  assert.equal(fileLinkMarkdown({ displayName: 'a[b]', sourceUrl: 'https://a.example/f' }), '[a\\[b\\]](https://a.example/f)');
  assert.equal(fileLinkMarkdown({ displayName: 'x' }), null);
});

test('insertAtCursor: 커서 위치에 넣고 양옆 공백을 보장한다', () => {
  assert.deepEqual(insertAtCursor('', 0, '[a](u)'), { value: '[a](u)', cursor: 6 });
  assert.deepEqual(insertAtCursor('hello', 5, '[a](u)'), { value: 'hello [a](u)', cursor: 12 });
  assert.deepEqual(insertAtCursor('helloworld', 5, 'X'), { value: 'hello X world', cursor: 8 });
  assert.deepEqual(insertAtCursor('a b', 99, 'X'), { value: 'a b X', cursor: 5 });
});
