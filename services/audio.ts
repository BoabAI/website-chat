// Utilities for handling Gemini TTS Raw PCM Audio

let audioContext: AudioContext | null = null;

export const getAudioContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000, // Gemini TTS usually outputs 24kHz
    });
  }
  return audioContext;
};

export const decodeBase64Audio = (base64String: string): Uint8Array => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const playAudioData = async (
  base64Audio: string,
  onEnded?: () => void,
  onStarted?: () => void
): Promise<AudioBufferSourceNode> => {
  const ctx = getAudioContext();
  
  // Ensure context is running (user interaction usually required first)
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const audioBytes = decodeBase64Audio(base64Audio);
  
  // Gemini TTS returns raw PCM 16-bit, 24kHz, Mono (usually)
  // We need to convert it to an AudioBuffer
  const dataInt16 = new Int16Array(audioBytes.buffer);
  const channelCount = 1;
  const sampleRate = 24000;
  
  const audioBuffer = ctx.createBuffer(channelCount, dataInt16.length, sampleRate);
  const channelData = audioBuffer.getChannelData(0);
  
  // Normalize 16-bit int to float [-1.0, 1.0]
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  
  source.onended = () => {
    if (onEnded) onEnded();
  };

  source.start();

  // Signal that audio playback has actually started
  if (onStarted) onStarted();

  return source;
};
