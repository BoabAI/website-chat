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
  endTurn: () => void;
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
        console.log("Gemini Live Session Connected");
        connected = true;
      },
      onmessage: (message: LiveServerMessage) => {
        const content = message.serverContent;
        if (!content) return;

        // User speech transcription
        if (content.inputTranscription?.text) {
          console.log("Received User Transcript:", content.inputTranscription.text);
          callbacks.onUserText(content.inputTranscription.text);
        }

        // Model speech transcription
        if (content.outputTranscription?.text) {
          console.log("Received Model Transcript:", content.outputTranscription.text);
          callbacks.onModelText(content.outputTranscription.text);
        }

        // Audio chunks from model
        const parts = content.modelTurn?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              // console.log("Received Audio Chunk"); // Too noisy
              callbacks.onAudio(part.inlineData.data);
            }
          }
        }

        // Turn complete
        if (content.turnComplete) {
          console.log("Gemini Turn Complete");
          callbacks.onTurnComplete();
        }
      },
      onerror: (e: any) => {
        console.error("Gemini Live Session Error:", e);
        callbacks.onError(new Error(e.message || "Live session error"));
      },
      onclose: () => {
        console.log("Gemini Live Session Closed");
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
          disabled: true,
        },
      },
    },
  });

  let chunkCount = 0;

  return {
    sendAudio: (audioData: Int16Array) => {
      if (!connected || !session) return;
      
      chunkCount++;
      if (chunkCount % 50 === 0) {
        console.log(`Sending Audio Chunk #${chunkCount} (size: ${audioData.byteLength})`);
      }

      const uint8Array = new Uint8Array(audioData.buffer);
      let binary = '';
      const len = uint8Array.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const base64 = btoa(binary);

      session.sendRealtimeInput({
        audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
      });
    },

    sendText: (text: string) => {
      if (!connected || !session) return;
      console.log("Sending Text:", text);
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      });
    },

    endTurn: () => {
      if (!connected || !session) {
        console.warn("Cannot end turn: Session not connected");
        return;
      }
      console.log("Ending Turn (Client)");
      session.sendClientContent({
        turnComplete: true,
      });
    },

    close: () => {
      console.log("Closing Session");
      if (session) session.close();
      connected = false;
    },

    isConnected: () => connected,
  };
};
