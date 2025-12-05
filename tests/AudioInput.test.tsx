import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import App from '../App';

// Mock services
vi.mock('../services/scraper', () => ({
  scrapeWebsite: vi.fn().mockResolvedValue({
    success: true,
    title: 'Test Site',
    content: 'This is a test website content.'
  })
}));

vi.mock('../services/gemini', () => ({
  generateWebsiteSummary: vi.fn(),
  streamChatResponse: vi.fn().mockImplementation(async (transcript, context, history, callbacks) => {
     // Simulate a simple response
     callbacks.onSentence("I heard you.");
     callbacks.onFullText("I heard you.", []);
  }),
  generateSpeech: vi.fn().mockResolvedValue('fake-audio-base64')
}));

vi.mock('../services/audio', () => ({
  playAudioChunk: vi.fn(),
  stopAudio: vi.fn(),
  resetAudioTiming: vi.fn(),
  waitForAudioEnd: vi.fn().mockResolvedValue(undefined)
}));

// Mock visualizer to avoid canvas issues in JSDOM
vi.mock('../components/Waveform', () => ({
  default: () => <div data-testid="waveform">Waveform</div>
}));

// Capture the recognition instance to trigger events
let recognitionInstance: any;

class MockSpeechRecognition {
  continuous = true;
  interimResults = false;
  lang = '';
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    recognitionInstance = this;
  }

  start = vi.fn();
  stop = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  recognitionInstance = null;
  (window as any).webkitSpeechRecognition = MockSpeechRecognition;
});

describe('Audio Input Integration', () => {
  it('processes audio input from push-to-talk', async () => {
    render(<App />);

    // 1. Enter URL and Start to get to Chatting state
    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, { target: { value: 'https://test.com' } });
    
    const startBtn = screen.getByRole('button', { name: /Start/i });
    fireEvent.click(startBtn);

    // 2. Wait for Chat Interface (Scraping finished)
    await waitFor(() => {
      expect(screen.getByText('Test Site')).toBeInTheDocument();
    }, { timeout: 3000 });

    // 3. Find Push to Talk button
    const talkBtn = screen.getByRole('button', { name: /Hold to talk/i });
    expect(talkBtn).toBeInTheDocument();

    // 4. Simulate Mouse Down to start listening
    fireEvent.mouseDown(talkBtn);

    // 5. Verify recognition started
    await waitFor(() => {
       expect(recognitionInstance).toBeDefined();
       expect(recognitionInstance.start).toHaveBeenCalled();
    });

    // 6. Simulate Speech Result
    const mockResultEvent = {
      results: [
        Object.assign(
          [
            { transcript: 'Hello world' }
          ],
          { isFinal: true }
        )
      ]
    };

    await act(async () => {
      if (recognitionInstance && recognitionInstance.onresult) {
        recognitionInstance.onresult(mockResultEvent);
      }
    });

    // 7. Verify message appears in the chat
    await waitFor(() => {
      expect(screen.getByText('Hello world')).toBeInTheDocument();
    });

    // 8. Verify response logic was triggered (Mocked streamChatResponse adds "I heard you.")
    await waitFor(() => {
       expect(screen.getByText('I heard you.')).toBeInTheDocument();
    });
  });
});
