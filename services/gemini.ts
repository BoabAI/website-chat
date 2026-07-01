import { GroundingSource } from '../types';

// All Gemini calls go through our server-side proxy (see ../lambda/) so the API
// key never ships in the client bundle. The proxy URL is injected at build time
// via VITE_PROXY_URL (Vite only exposes VITE_-prefixed env vars to the client).
const getProxyUrl = (): string => {
  const url = import.meta.env.VITE_PROXY_URL;
  if (!url) {
    throw new Error('VITE_PROXY_URL is not configured');
  }
  return url;
};

// Stable per-browser id so the proxy can rate-limit IP-rotating abuse.
const getDeviceId = (): string => {
  const KEY = 'wc_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
};

const postProxy = (body: Record<string, unknown>): Promise<Response> =>
  fetch(getProxyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, deviceId: getDeviceId() }),
  });

interface ChatResponse {
  text: string;
  groundingSources: GroundingSource[];
}

// Streaming version - yields sentences as they complete
export interface StreamCallbacks {
  onSentence: (sentence: string) => void;
  onFullText: (text: string, groundingSources: GroundingSource[]) => void;
  onError: (error: Error) => void;
}

export const streamChatResponse = async (
  prompt: string,
  context: string,
  history: { role: string; text: string }[],
  callbacks: StreamCallbacks
): Promise<void> => {
  let buffer = '';
  let fullText = '';

  // Regex to find complete sentences (ending with . ! ?)
  const sentenceEndRegex = /^(.*?[.!?])(\s*)(.*)$/s;

  const drainSentences = () => {
    let match;
    while ((match = sentenceEndRegex.exec(buffer)) !== null) {
      const sentence = match[1].trim();
      if (sentence) {
        callbacks.onSentence(sentence);
      }
      buffer = match[3]; // Remaining text after the sentence
    }
  };

  try {
    const response = await postProxy({ action: 'chat', prompt, context, history });

    if (!response.ok || !response.body) {
      throw new Error(`Proxy chat request failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (!text) continue;
      buffer += text;
      fullText += text;
      drainSentences();
    }

    // Flush any multibyte remainder held by the decoder.
    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
      fullText += tail;
      drainSentences();
    }

    // Handle any remaining text in buffer (incomplete sentence at end)
    if (buffer.trim()) {
      callbacks.onSentence(buffer.trim());
    }

    // Streaming doesn't provide grounding metadata, so empty array
    callbacks.onFullText(fullText, []);
  } catch (error) {
    console.error('Streaming Chat Error:', error);
    callbacks.onError(error as Error);
  }
};

export const generateWebsiteSummary = async (url: string): Promise<ChatResponse> => {
  try {
    const response = await postProxy({ action: 'summary', url });
    if (!response.ok) {
      throw new Error(`Proxy summary request failed: ${response.status}`);
    }
    const data = await response.json();
    return {
      text: data.text || "I found the website but couldn't generate a summary.",
      groundingSources: data.groundingSources || [],
    };
  } catch (error) {
    console.error('Summary Generation Error:', error);
    return {
      text: "I couldn't access the website directly or via search. Please check the URL.",
      groundingSources: [],
    };
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const response = await postProxy({ action: 'speech', text });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.audio ?? null;
  } catch (error) {
    console.error('TTS Generation Error:', error);
    return null;
  }
};
