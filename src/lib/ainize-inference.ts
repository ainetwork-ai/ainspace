/** Server-only installation AI gateway; never falls back to a public provider. */
export function ainizeInferenceConfig(env: Record<string, string | undefined> = process.env) {
  const raw = env.AINIZE_URL?.trim();
  const key = env.AINIZE_API_KEY?.trim();
  if (!raw || !key) return null;
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return {
      base: url.toString().replace(/\/+$/, '').replace(/\/v1$/, ''),
      key,
      chatModel: env.AINIZE_CHAT_MODEL?.trim() || 'Qwen3.8-Flash-Next',
      imageEditModel: env.AINIZE_IMAGE_EDIT_MODEL?.trim() || null,
    };
  } catch { return null; }
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Ainize inference unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Ainize response exceeds limit');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Ainize response unavailable');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function generateAinizeText(prompt: string, fetcher: typeof fetch = fetch): Promise<string> {
  const config = ainizeInferenceConfig();
  if (!config) throw new Error('Ainize is not configured');
  const response = await fetcher(`${config.base}/v1/chat/completions`, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(90_000),
    headers: { authorization: `Bearer ${config.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.chatModel, messages: [{ role: 'user', content: prompt }], max_tokens: 256, stream: false }),
  });
  const result = await readJson(response, 262_144) as { choices?: { message?: { content?: unknown } }[] };
  const text = result.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim() || text.length > 4096) throw new Error('Ainize response unavailable');
  return text.trim();
}

/** Original image is sent to an actual edit model; prompt-only generation is insufficient. */
export async function editAinizeImage(image: File, prompt: string, fetcher: typeof fetch = fetch): Promise<string> {
  const config = ainizeInferenceConfig();
  if (!config?.imageEditModel) throw new Error('Ainize image editing is not configured');
  const body = new FormData();
  body.append('image', image);
  body.append('model', config.imageEditModel);
  body.append('prompt', prompt);
  body.append('n', '1'); body.append('size', '512x512'); body.append('response_format', 'b64_json');
  const response = await fetcher(`${config.base}/v1/images/edits`, {
    method: 'POST', body, cache: 'no-store', signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${config.key}` },
  });
  const result = await readJson(response, 24 * 1024 * 1024) as { data?: { b64_json?: unknown }[] };
  const encoded = result.data?.[0]?.b64_json;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Ainize image unavailable');
  const png = Buffer.from(encoded, 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Ainize PNG unavailable');
  return `data:image/png;base64,${encoded}`;
}
