import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huddleLaunchUrl } from './huddle-launch-url';
test('configured Teams origin yields a credential-free source join link', () => {
  assert.equal(huddleLaunchUrl('https://teams.example', 'my-space'), 'https://teams.example/meetings/space?slug=my-space');
  assert.equal(huddleLaunchUrl('http://localhost:17890', 'my-space'), 'http://localhost:17890/meetings/space?slug=my-space');
});
test('rejects unsafe or ambiguous launch configuration and malformed source', () => {
  for (const base of [undefined, 'http://teams.example', 'https://user:secret@teams.example', 'https://teams.example/path', 'https://teams.example?token=x', 'javascript:alert(1)']) assert.equal(huddleLaunchUrl(base, 'my-space'), null);
  assert.equal(huddleLaunchUrl('https://teams.example', '../other'), null);
});
