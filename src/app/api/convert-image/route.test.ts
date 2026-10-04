import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { getJob, deleteJob } from '@/lib/jobManager';

test('route imports without OpenAI credentials and missing credentials fail only the submitted job', async (t) => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    t.after(() => {
        if (previous === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previous;
    });
    const { POST } = await import('./route');
    const missingImage = await POST(new NextRequest('http://localhost/api/convert-image', {
        method: 'POST', body: new FormData()
    }));
    assert.equal(missingImage.status, 400);
    assert.deepEqual(await missingImage.json(), { error: 'No image provided' });

    const form = new FormData();
    form.set('image', new File(['test'], 'input.png', { type: 'image/png' }));
    const response = await POST(new NextRequest('http://localhost/api/convert-image', {
        method: 'POST', body: form
    }));
    assert.equal(response.status, 200);
    const { jobId, success } = await response.json();
    t.after(() => deleteJob(jobId));
    assert.equal(success, true);
    assert.equal(getJob(jobId)?.status, 'pending');
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(getJob(jobId)?.status, 'failed');
    assert.match(getJob(jobId)?.error ?? '', /credentials|OPENAI_API_KEY/i);
});
