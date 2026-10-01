import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

test('image conversion route loads without credentials and rejects unavailable service', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const { POST } = await import('./route');
    const form = new FormData();
    form.set('image', new File(['test'], 'input.png', { type: 'image/png' }));
    const response = await POST(new NextRequest('http://localhost/api/convert-image', {
      method: 'POST', body: form,
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Image conversion is unavailable' });
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
