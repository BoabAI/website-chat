import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

// Simplified Live API service for real-time voice conversations

export interface LiveCallbacks {
  onAudio: (base64Audio: string) => void;
  onUserText: (text: string) => void;
  onModelText: (text: string) => void;
  onTurnComplete: () => void;
  onError: (error: Error) => void;
}

export interface LiveSession {
  sendAudio: (audioData: Int16Array) => void;
  sendText: (text: string) => void;
  close: () => void;
  isConnected: () => boolean;
}

export const createLiveSession = async (
  systemInstruction: string,
  callbacks: LiveCallbacks
): Promise<LiveSession> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY is missing");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  let session: any = null;
  let connected = false;

  session = await ai.live.connect({
    model: "gemini-live-2.5-flash-preview",
    callbacks: {
      onopen: () => {
        connected = true;
      },
      onmessage: (message: LiveServerMessage) => {
        const content = message.serverContent;
        if (!content) return;

        // User speech transcription
        if (content.inputTranscription?.text) {
          callbacks.onUserText(content.inputTranscription.text);
        }

        // Model speech transcription
        if (content.outputTranscription?.text) {
          callbacks.onModelText(content.outputTranscription.text);
        }

        // Audio chunks from model
        const parts = content.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              callbacks.onAudio(part.inlineData.data);
            }
          }
        }

        // Turn complete
        if (content.turnComplete) {
          callbacks.onTurnComplete();
        }
      },
      onerror: (e: any) => {
        callbacks.onError(new Error(e.message || "Live session error"));
      },
      onclose: () => {
        connected = false;
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
      outputAudioTranscription: {},
      inputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
        },
      },
    },
  });

  return {
    sendAudio: (audioData: Int16Array) => {
      if (!connected || !session) return;
      const uint8Array = new Uint8Array(audioData.buffer);
      const base64 = btoa(String.fromCharCode(...uint8Array));
      session.sendRealtimeInput({
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      });
    },

    sendText: (text: string) => {
      if (!connected || !session) return;
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },

    close: () => {
      if (session) session.close();
      connected = false;
    },

    isConnected: () => connected,
  };
};
