// Microphone streaming service for Live API
// Captures audio at 16kHz and streams to callback

export interface MicrophoneStream {
  start: () => Promise<void>;
  stop: () => void;
  isActive: () => boolean;
}

export const createMicrophoneStream = (
  onAudioData: (audioData: Int16Array) => void,
  onError?: (error: Error) => void
): MicrophoneStream => {
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let active = false;

  return {
    start: async () => {
      if (active) return;

      try {
        // Request microphone access
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });

        // Create AudioContext at 16kHz for Live API input
        audioContext = new AudioContext({ sampleRate: 16000 });

        // Load the audio worklet
        await audioContext.audioWorklet.addModule('/audio-recorder-worklet.js');

        // Create source from microphone
        source = audioContext.createMediaStreamSource(mediaStream);

        // Create worklet node
        workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-worklet');

        // Handle audio data from worklet
        workletNode.port.onmessage = (event) => {
          if (event.data.type === 'audio') {
            const int16Data = new Int16Array(event.data.data);
            onAudioData(int16Data);
          }
        };

        // Connect: microphone -> worklet
        source.connect(workletNode);

        active = true;
        console.log('Microphone streaming started at 16kHz');
      } catch (error) {
        console.error('Failed to start microphone:', error);
        if (onError) {
          onError(error as Error);
        }
      }
    },

    stop: () => {
      if (!active) return;

      // Disconnect and cleanup
      if (workletNode) {
        workletNode.disconnect();
        workletNode = null;
      }

      if (source) {
        source.disconnect();
        source = null;
      }

      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }

      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }

      active = false;
      console.log('Microphone streaming stopped');
    },

    isActive: () => active,
  };
};
