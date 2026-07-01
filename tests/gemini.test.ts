import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  streamChatResponse,
  generateWebsiteSummary,
  generateSpeech,
  type StreamCallbacks,
} from '../services/gemini';

const PROXY = 'https://proxy.test/';

// Build a fetch Response whose body streams the given text chunks.
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => data } as unknown as Response;
}

const makeCallbacks = () => {
  const sentences: string[] = [];
  let full: { text: string; sources: unknown[] } | null = null;
  let error: Error | null = null;
  const callbacks: StreamCallbacks = {
    onSentence: (s) => sentences.push(s),
    onFullText: (text, sources) => {
      full = { text, sources };
    },
    onError: (e) => {
      error = e;
    },
  };
  return { callbacks, sentences, get full() { return full; }, get error() { return error; } };
};

describe('gemini proxy client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PROXY_URL', PROXY);
    // Provide a deterministic in-memory localStorage (jsdom doesn't expose one
    // as a bare global in this setup).
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
    });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('streams sentences from the proxy and reports full text', async () => {
    (fetch as any).mockResolvedValue(
      streamResponse(['Hello world. This ', 'is a test! Final frag'])
    );
    const h = makeCallbacks();

    await streamChatResponse('hi', 'ctx', [], h.callbacks);

    expect(h.sentences).toEqual(['Hello world.', 'This is a test!', 'Final frag']);
    expect(h.full?.text).toBe('Hello world. This is a test! Final frag');
    expect(h.error).toBeNull();
  });

  it('posts the correct action/body to the proxy URL', async () => {
    (fetch as any).mockResolvedValue(streamResponse(['ok.']));
    const h = makeCallbacks();

    await streamChatResponse('question', 'context', [{ role: 'user', text: 'prev' }], h.callbacks);

    expect(fetch).toHaveBeenCalledWith(PROXY, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.action).toBe('chat');
    expect(body.prompt).toBe('question');
    expect(body.context).toBe('context');
    expect(body.history).toEqual([{ role: 'user', text: 'prev' }]);
    expect(typeof body.deviceId).toBe('string');
    expect(body.deviceId.length).toBeGreaterThan(0);
  });

  it('reuses a stable deviceId across calls', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ audio: 'AA' }));
    await generateSpeech('one');
    await generateSpeech('two');
    const first = JSON.parse((fetch as any).mock.calls[0][1].body).deviceId;
    const second = JSON.parse((fetch as any).mock.calls[1][1].body).deviceId;
    expect(first).toBe(second);
  });

  it('surfaces rate-limit (429) as onError, no sentences emitted', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 429, body: null } as unknown as Response);
    const h = makeCallbacks();

    await streamChatResponse('hi', 'ctx', [], h.callbacks);

    expect(h.sentences).toEqual([]);
    expect(h.error).toBeInstanceOf(Error);
  });

  it('returns audio base64 from generateSpeech', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ audio: 'QUJD' }));
    await expect(generateSpeech('speak')).resolves.toBe('QUJD');
  });

  it('returns null when generateSpeech proxy fails', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ audio: null }, false, 502));
    await expect(generateSpeech('speak')).resolves.toBeNull();
  });

  it('returns text and grounding sources from generateWebsiteSummary', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({ text: 'A cool site.', groundingSources: [{ uri: 'u', title: 't' }] })
    );
    const result = await generateWebsiteSummary('https://x.com');
    expect(result.text).toBe('A cool site.');
    expect(result.groundingSources).toEqual([{ uri: 'u', title: 't' }]);
  });

  it('falls back gracefully when summary proxy errors', async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const result = await generateWebsiteSummary('https://x.com');
    expect(result.text).toMatch(/couldn't access/i);
    expect(result.groundingSources).toEqual([]);
  });

  it('returns null from generateSpeech when proxy URL is not configured', async () => {
    vi.stubEnv('VITE_PROXY_URL', '');
    await expect(generateSpeech('x')).resolves.toBeNull();
  });
});
