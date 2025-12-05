// Simplified audio playback for Gemini Live API (24kHz PCM)

let audioContext: AudioContext | null = null;
let nextStartTime = 0;

const getContext = (): AudioContext => {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: 24000 });
  }
  return audioContext;
};

// Convert base64 PCM to playable audio
const decodeAudio = (base64: string): Float32Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
};

// Play audio chunk immediately (queued for seamless playback)
export const playAudioChunk = async (base64Audio: string) => {
  const ctx = getContext();

  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const audioData = decodeAudio(base64Audio);
  const buffer = ctx.createBuffer(1, audioData.length, 24000);
  buffer.copyToChannel(audioData, 0);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);

  // Schedule seamlessly after previous chunk
  if (nextStartTime < ctx.currentTime) {
    nextStartTime = ctx.currentTime;
  }
  source.start(nextStartTime);
  nextStartTime += buffer.duration;
};

// Stop all audio and reset
export const stopAudio = () => {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  nextStartTime = 0;
};

// Reset timing for new response
export const resetAudioTiming = () => {
  const ctx = getContext();
  nextStartTime = ctx.currentTime;
};
