import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SharedFilePicker from './SharedFilePicker';
import { withEnv } from '@/lib/ain-integration/__tests__/helpers';

test('플래그 off(기본) → 아무것도 렌더링하지 않는다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: undefined }, () => {
  assert.equal(renderToStaticMarkup(<SharedFilePicker onPick={() => {}} />), '');
}));

test('플래그 on → "공유 파일" 진입점이 보인다', withEnv({ NEXT_PUBLIC_AIN_INTEGRATION_ENABLED: 'true' }, () => {
  const html = renderToStaticMarkup(<SharedFilePicker onPick={() => {}} />);
  assert.ok(html.includes('공유 파일'));
  assert.ok(html.includes('data-testid="shared-file-picker"'));
}));
