import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ainizeInferenceConfig, generateAinizeText, editAinizeImage } from './ainize-inference';

async function withConfig(run: () => Promise<void>) {
  const names = ['AINIZE_URL', 'AINIZE_API_KEY', 'AINIZE_CHAT_MODEL', 'AINIZE_IMAGE_EDIT_MODEL'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { AINIZE_URL: 'https://owned-ainize.invalid/v1/', AINIZE_API_KEY: 'owned-test-key', AINIZE_CHAT_MODEL: 'owned-chat-model', AINIZE_IMAGE_EDIT_MODEL: 'owned-edit-model' });
  try { await run(); }
  finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
}

test('Ainize configuration requires explicit gateway and credentials, rejects unsafe URL components', () => {
  assert.equal(ainizeInferenceConfig({}), null);
  assert.equal(ainizeInferenceConfig({ AINIZE_URL: 'https://ainize.invalid' }), null);
  for (const AINIZE_URL of ['file:///tmp/model', 'https://user:password@ainize.invalid', 'https://ainize.invalid?key=x', 'https://ainize.invalid#token']) {
    assert.equal(ainizeInferenceConfig({ AINIZE_URL, AINIZE_API_KEY: 'owned-test-key' }), null);
  }
  assert.equal(ainizeInferenceConfig({ AINIZE_URL: 'http://127.0.0.1:3402/v1/', AINIZE_API_KEY: 'owned-test-key' })?.base, 'http://127.0.0.1:3402');
});

test('world text goes only to the configured Ainize model with credentials in headers', async () => withConfig(async () => {
  let calls = 0;
  const text = await generateAinizeText('Owned test prompt', async (url, init) => {
    calls += 1;
    assert.equal(url, 'https://owned-ainize.invalid/v1/chat/completions');
    assert.ok(new Headers(init?.headers).get('authorization') === 'Bearer owned-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'owned-chat-model');
    assert.equal(body.messages[0].content, 'Owned test prompt');
    assert.equal(body.stream, false);
    return Response.json({ choices: [{ message: { content: '  함께 탐험해요.  ' } }] });
  });
  assert.equal(text, '함께 탐험해요.');
  assert.equal(calls, 1);
}));

test('image conversion retains the original uploaded image and uses editing rather than generation', async () => withConfig(async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1cAAAAASUVORK5CYII=';
  const image = new File([Buffer.from(png, 'base64')], 'owned.png', { type: 'image/png' });
  const edited = await editAinizeImage(image, 'Owned conversion instruction', async (url, init) => {
    assert.equal(url, 'https://owned-ainize.invalid/v1/images/edits');
    assert.ok(init?.body instanceof FormData);
    const uploaded = init.body.get('image');
    assert.ok(uploaded instanceof File);
    assert.equal(Buffer.from(await uploaded.arrayBuffer()).toString('base64'), png);
    assert.equal(init.body.get('model'), 'owned-edit-model');
    assert.equal(init.body.get('prompt'), 'Owned conversion instruction');
    return Response.json({ data: [{ b64_json: png }] });
  });
  assert.ok(edited.startsWith('data:image/png;base64,'));
}));

test('provider errors are fixed messages and never trigger another provider', async () => withConfig(async () => {
  let calls = 0;
  await assert.rejects(generateAinizeText('Owned prompt', async () => {
    calls += 1;
    return Response.json({ error: { message: 'private upstream details' } }, { status: 503 });
  }), (error: unknown) => error instanceof Error && error.message === 'Ainize inference unavailable');
  assert.equal(calls, 1);
  delete process.env.AINIZE_IMAGE_EDIT_MODEL;
  await assert.rejects(editAinizeImage(new File(['input'], 'owned.png'), 'Owned prompt', async () => { calls += 1; return Response.json({}); }));
  assert.equal(calls, 1);
}));

test('text responses exceeding the bounded body are cancelled', async () => withConfig(async () => {
  let cancelled = false;
  await assert.rejects(generateAinizeText('Owned prompt', async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(262_145)); },
    cancel() { cancelled = true; },
  }))));
  assert.equal(cancelled, true);
}));
