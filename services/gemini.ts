import { GoogleGenAI, Modality } from "@google/genai";
import { GroundingSource } from "../types";

// Initialize Gemini Client
// IMPORTANT: API_KEY is expected from process.env.API_KEY
const getAiClient = () => {
  if (!process.env.API_KEY) {
    console.error("API_KEY is missing from environment variables");
    throw new Error("API Key missing");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

const SYSTEM_INSTRUCTION_BASE = `You are a helpful assistant discussing a website.

WEBSITE CONTEXT:
{{context}}

If the user asks about the website, use the context provided.
If the context is missing or insufficient, or if the user asks about current events, YOU MUST USE THE googleSearch TOOL to find the answer.

CRITICAL: Answer in 1-2 short sentences maximum. Be direct and conversational. No lists, bullet points, or long explanations. Your response will be spoken aloud.`;

interface ChatResponse {
  text: string;
  groundingSources: GroundingSource[];
}

// Non-streaming version (kept for compatibility)
export const generateChatResponse = async (
  prompt: string,
  context: string,
  history: { role: string; text: string }[]
): Promise<ChatResponse> => {
  const ai = getAiClient();

  const systemInstruction = SYSTEM_INSTRUCTION_BASE.replace(
    '{{context}}',
    context || "The user provided a URL but we couldn't scrape it. Please use your Google Search tool to find information about the URL provided by the user."
  );

  const contents = [
    ...history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    })),
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
      }
    });

    const text = response.text || "I couldn't generate a response.";

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingSources: GroundingSource[] = groundingChunks
      .filter((chunk: any) => chunk.web?.uri && chunk.web?.title)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title
      }));

    return { text, groundingSources };

  } catch (error) {
    console.error("Chat Generation Error:", error);
    return { text: "Sorry, I encountered an error connecting to Gemini.", groundingSources: [] };
  }
};

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
  const ai = getAiClient();

  const systemInstruction = SYSTEM_INSTRUCTION_BASE.replace(
    '{{context}}',
    context || "The user provided a URL but we couldn't scrape it. Please use your Google Search tool to find information about the URL provided by the user."
  );

  const contents = [
    ...history.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    })),
    {
      role: 'user',
      parts: [{ text: prompt }]
    }
  ];

  let buffer = '';
  let fullText = '';

  // Regex to find complete sentences (ending with . ! ?)
  const sentenceEndRegex = /^(.*?[.!?])(\s*)(.*)$/s;

  try {
    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: contents,
      config: {
        systemInstruction,
        // Note: tools not supported in streaming mode, so no googleSearch here
      }
    });

    for await (const chunk of response) {
      const text = chunk.text || '';
      buffer += text;
      fullText += text;

      // Extract complete sentences from buffer
      let match;
      while ((match = sentenceEndRegex.exec(buffer)) !== null) {
        const sentence = match[1].trim();
        if (sentence) {
          console.log('[streamChatResponse] Sentence ready:', sentence);
          callbacks.onSentence(sentence);
        }
        buffer = match[3]; // Remaining text after the sentence
      }
    }

    // Handle any remaining text in buffer (incomplete sentence at end)
    if (buffer.trim()) {
      console.log('[streamChatResponse] Final fragment:', buffer.trim());
      callbacks.onSentence(buffer.trim());
    }

    // Streaming doesn't provide grounding metadata, so empty array
    callbacks.onFullText(fullText, []);

  } catch (error) {
    console.error("Streaming Chat Error:", error);
    callbacks.onError(error as Error);
  }
};

export const generateWebsiteSummary = async (url: string): Promise<ChatResponse> => {
  const ai = getAiClient();

  const systemInstruction = `You are a helpful assistant. The user wants to know about a specific website URL.
  Use Google Search to find out what the website is about and provide a 1-2 sentence summary.
  Start by mentioning the name of the website. Be brief.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `Summarize this website: ${url}` }] }],
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
      }
    });

    const text = response.text || "I found the website but couldn't generate a summary.";

    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingSources: GroundingSource[] = groundingChunks
      .filter((chunk: any) => chunk.web?.uri && chunk.web?.title)
      .map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title
      }));

    return { text, groundingSources };

  } catch (error) {
    console.error("Summary Generation Error:", error);
    return { text: "I couldn't access the website directly or via search. Please check the URL.", groundingSources: [] };
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  const ai = getAiClient();

  try {
    // Wrap text with Australian English accent and faster pace instruction
    const promptText = `Speak with an Australian English accent at a slightly faster, energetic pace: ${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: promptText }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;

  } catch (error) {
    console.error("TTS Generation Error:", error);
    return null;
  }
};
