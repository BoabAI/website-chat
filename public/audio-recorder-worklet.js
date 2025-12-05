// Audio Worklet for capturing microphone input at 16kHz
// Buffers audio samples and sends them as Int16 chunks to the main thread

class AudioRecorderWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(2048); // ~128ms at 16kHz
    this.bufferWriteIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel0 = input[0];
      this.processChunk(channel0);
    }
    return true; // Keep processor alive
  }

  processChunk(float32Array) {
    for (let i = 0; i < float32Array.length; i++) {
      // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const int16Value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.buffer[this.bufferWriteIndex++] = int16Value;

      // When buffer is full, send to main thread
      if (this.bufferWriteIndex >= this.buffer.length) {
        this.sendBuffer();
      }
    }
  }

  sendBuffer() {
    // Send a copy of the buffer to the main thread
    this.port.postMessage({
      type: 'audio',
      data: this.buffer.slice(0, this.bufferWriteIndex).buffer
    }, [this.buffer.slice(0, this.bufferWriteIndex).buffer]);

    // Reset buffer
    this.buffer = new Int16Array(2048);
    this.bufferWriteIndex = 0;
  }
}

registerProcessor('audio-recorder-worklet', AudioRecorderWorklet);
