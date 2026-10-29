import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './route';

// On Ainize the running commit comes from AINIZE_COMMIT (Vercel set VERCEL_GIT_COMMIT_SHA).
test('health reports the commit the hosting platform says is running', async t => {
  const sha = 'a'.repeat(40);
  for (const key of ['VERCEL_GIT_COMMIT_SHA', 'GIT_SHA', 'AINIZE_COMMIT']) {
    const old = process.env[key]; delete process.env[key];
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  process.env.AINIZE_COMMIT = sha;
  assert.deepEqual(await (await GET()).json(), { status: 'ok', sha });
  process.env.AINIZE_COMMIT = 'not-a-sha';
  assert.deepEqual(await (await GET()).json(), { status: 'ok', sha: null });
});
