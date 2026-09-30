import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionProof } from './session-proof';
import { withEnv } from './__tests__/helpers';

// 공통 항목 B: Space 는 AIN SSO 로그인이 없다 → 운영에서 세션 증명은 항상 null.
test('B(해당 없음): 운영에서는 어떤 사용자든 null — 개발 파일도 무시', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'proof-'));
  const file = join(dir, 'id_token');
  writeFileSync(file, 'aaa.bbb.ccc');
  await withEnv({ NODE_ENV: 'production', AIN_SESSION_PROOF_FILE: file }, async () => {
    assert.equal(await getSessionProof('user-42'), null);
  })();
  await withEnv({ NODE_ENV: 'test', AIN_SESSION_PROOF_FILE: undefined }, async () => {
    assert.equal(await getSessionProof('user-42'), null);
  })();
  // 개발 전용 파일은 JWT 모양일 때만
  await withEnv({ NODE_ENV: 'test', AIN_SESSION_PROOF_FILE: file }, async () => {
    assert.equal(await getSessionProof('user-42'), 'aaa.bbb.ccc');
  })();
});
