/**
 * Gemini proxy Lambda (Function URL, RESPONSE_STREAM).
 *
 * Holds GEMINI_API_KEY server-side so it never ships in the client bundle.
 * The browser calls this endpoint instead of talking to Google directly.
 *
 * Actions (JSON body, POST):
 *   { action: 'chat',    prompt, context, history, deviceId }  -> streamed text/plain
 *   { action: 'summary', url, deviceId }                       -> { text, groundingSources }
 *   { action: 'speech',  text, deviceId }                      -> { audio } (base64 PCM) | { audio: null }
 *
 * Defence in depth: DynamoDB rate limiting (rateLimit.mjs), per-call input
 * caps, and maxOutputTokens on generation to bound worst-case cost.
 *
 * CORS is configured on the Function URL resource, not here (adding headers in
 * both places causes duplicates).
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { checkRateLimit, hashIp } from './rateLimit.mjs';

const MODEL_CHAT = 'gemini-2.5-flash';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const TTS_VOICE = 'Kore';

// Per-call input caps — a malicious client can bypass the frontend and POST
// directly, so bound the cost of any single request here.
const MAX_PROMPT = 4_000;
const MAX_CONTEXT = 24_000;
const MAX_TTS_TEXT = 2_000;
const MAX_URL = 2_000;
const MAX_HISTORY = 20;
const MAX_OUTPUT_TOKENS = 400;

const SYSTEM_INSTRUCTION_CHAT = `You are a helpful assistant discussing a website. Your PRIMARY knowledge source is the website context below.

WEBSITE CONTEXT (PRIMARY SOURCE - USE THIS FIRST):
{{context}}

RESPONSE PRIORITY:
1. FIRST: Answer from the WEBSITE CONTEXT above. This is your primary knowledge source.
2. ONLY IF the website context doesn't contain the answer, OR if the user asks about current events/news, use general knowledge as a SECONDARY source.

CRITICAL: Answer in 1-2 short sentences maximum. Be direct and conversational. No lists, bullet points, or long explanations. Your response will be spoken aloud.`;

const SYSTEM_INSTRUCTION_SUMMARY = `You are a helpful assistant. The user wants to know about a specific website URL.
Use Google Search to find out what the website is about and provide a 1-2 sentence summary.
Start by mentioning the name of the website. Be brief.`;

let aiClient = null;
function getAi() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the proxy');
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

function json(responseStream, statusCode, obj) {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
  stream.write(JSON.stringify(obj));
  stream.end();
}

const asString = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');

function buildContents(history, prompt) {
  const contents = [];
  if (Array.isArray(history)) {
    for (const msg of history.slice(-MAX_HISTORY)) {
      const role = msg?.role === 'model' ? 'model' : 'user';
      const text = asString(msg?.text, MAX_PROMPT);
      if (text) contents.push({ role, parts: [{ text }] });
    }
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });
  return contents;
}

function extractGroundingSources(response) {
  const chunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return chunks
    .filter((chunk) => chunk.web?.uri && chunk.web?.title)
    .map((chunk) => ({ uri: chunk.web.uri, title: chunk.web.title }));
}

async function handleChat(responseStream, body) {
  const prompt = asString(body.prompt, MAX_PROMPT);
  const context = asString(body.context, MAX_CONTEXT);
  if (!prompt) {
    json(responseStream, 400, { error: 'Missing prompt' });
    return;
  }

  const systemInstruction = SYSTEM_INSTRUCTION_CHAT.replace(
    '{{context}}',
    context ||
      "The user provided a URL but we couldn't scrape it. Answer from general knowledge about the URL the user mentions."
  );

  // Stream text deltas as text/plain — the client re-runs sentence splitting on
  // the incoming stream (mirrors the previous client-side SDK iteration).
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

  try {
    const response = await getAi().models.generateContentStream({
      model: MODEL_CHAT,
      contents: buildContents(body.history, prompt),
      config: { systemInstruction, maxOutputTokens: MAX_OUTPUT_TOKENS },
    });
    for await (const chunk of response) {
      const text = chunk.text || '';
      if (text) stream.write(text);
    }
  } catch (error) {
    // Headers already sent; we can only log and close cleanly.
    console.error('Chat stream error:', error);
  } finally {
    stream.end();
  }
}

async function handleSummary(responseStream, body) {
  const url = asString(body.url, MAX_URL);
  if (!url) {
    json(responseStream, 400, { error: 'Missing url' });
    return;
  }
  try {
    const response = await getAi().models.generateContent({
      model: MODEL_CHAT,
      contents: [{ role: 'user', parts: [{ text: `Summarize this website: ${url}` }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_SUMMARY,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });
    json(responseStream, 200, {
      text: response.text || "I found the website but couldn't generate a summary.",
      groundingSources: extractGroundingSources(response),
    });
  } catch (error) {
    console.error('Summary error:', error);
    json(responseStream, 502, {
      text: "I couldn't access the website directly or via search. Please check the URL.",
      groundingSources: [],
    });
  }
}

async function handleSpeech(responseStream, body) {
  const text = asString(body.text, MAX_TTS_TEXT);
  if (!text) {
    json(responseStream, 400, { audio: null });
    return;
  }
  try {
    const promptText = `Speak with an Australian English accent at a slightly faster, energetic pace: ${text}`;
    const response = await getAi().models.generateContent({
      model: MODEL_TTS,
      contents: [{ parts: [{ text: promptText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } },
        },
      },
    });
    const audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ?? null;
    json(responseStream, 200, { audio });
  } catch (error) {
    console.error('TTS error:', error);
    json(responseStream, 502, { audio: null });
  }
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event?.requestContext?.http?.method;
  if (method && method !== 'POST') {
    json(responseStream, 405, { error: 'Method not allowed' });
    return;
  }

  let body;
  try {
    const raw = event?.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
      : event?.body ?? '{}';
    body = JSON.parse(raw || '{}');
  } catch {
    json(responseStream, 400, { error: 'Invalid JSON body' });
    return;
  }

  const deviceId = asString(body.deviceId, 128) || 'anonymous';
  const ip = event?.requestContext?.http?.sourceIp ?? 'unknown';

  const rl = await checkRateLimit(hashIp(ip), deviceId);
  if (!rl.allowed) {
    json(responseStream, 429, {
      error: 'Rate limit exceeded. Please slow down and try again shortly.',
      tier: rl.tier,
    });
    return;
  }

  switch (body.action) {
    case 'chat':
      await handleChat(responseStream, body);
      return;
    case 'summary':
      await handleSummary(responseStream, body);
      return;
    case 'speech':
      await handleSpeech(responseStream, body);
      return;
    default:
      json(responseStream, 400, { error: `Unknown action: ${String(body.action)}` });
  }
});
