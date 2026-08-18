import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatJson, modelContextLength } from '../../server/compliance/ollamaClient.js';

afterEach(() => vi.unstubAllGlobals());

describe('Ollama client performance settings', () => {
  it('disables long thinking and bounds context and output generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await chatJson({ model: 'gemma4:e2b', system: 'system', user: 'user', schema: { type: 'object' } });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.think).toBe(false);
    expect(body.keep_alive).toBe('15m');
    expect(body.options.num_ctx).toBe(4096);
    expect(body.options.num_predict).toBe(640);
  });

  it('caps a model-declared context length to the runtime allocation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model_info: { 'gemma4.context_length': 131072 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(modelContextLength('gemma4:e2b')).resolves.toBe(4096);
  });
});
