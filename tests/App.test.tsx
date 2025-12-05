import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import App from '../App';

// Mock the hook
vi.mock('../hooks/useGeminiSession', () => ({
  useGeminiSession: () => ({
    isListening: false,
    isSpeaking: false,
    initSession: vi.fn(),
    startListening: vi.fn(),
    stopListening: vi.fn(),
    toggleListening: vi.fn(),
    sendTextMessage: vi.fn(),
    resetSession: vi.fn(),
    sessionRef: { current: { sendText: vi.fn() } }
  })
}));

// Mock services
vi.mock('../services/scraper', () => ({
  scrapeWebsite: vi.fn().mockResolvedValue({ success: true, title: 'Test Site', content: 'Content' })
}));

vi.mock('../services/gemini', () => ({
  generateWebsiteSummary: vi.fn()
}));

// Mock components that might cause issues in jsdom
vi.mock('../components/Waveform', () => ({
  default: () => <div data-testid="waveform">Waveform</div>
}));

describe('App', () => {
  it('renders the initial UI', () => {
    render(<App />);
    expect(screen.getByText('Chat with the Web')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
  });

  it('updates input value', () => {
    render(<App />);
    const input = screen.getByPlaceholderText('https://example.com') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://test.com' } });
    expect(input.value).toBe('https://test.com');
  });
});
