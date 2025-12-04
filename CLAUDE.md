# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SMEC AI website chat Chat is a React application that enables voice conversations with website content. Users enter a URL, the app scrapes the content (or falls back to Gemini Search Grounding), and then allows voice-based Q&A with speech synthesis responses.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start dev server on port 3000
npm run build      # Production build
npm run preview    # Preview production build
```

## Environment Setup

Create `.env.local` with:
```
GEMINI_API_KEY=your-key-here
```

The API key is injected via Vite's `define` in `vite.config.ts:14-15`.

## Architecture

### Data Flow
1. **URL Input** → `scraper.ts` attempts CORS proxy fetch → Falls back to Gemini Search Grounding if blocked
2. **User speaks** → `VoiceInput.tsx` uses Web Speech API (webkitSpeechRecognition) → Text sent to Gemini
3. **Gemini responds** → `gemini.ts` with `googleSearch` tool enabled → Response passed to TTS
4. **Audio playback** → `audio.ts` converts raw PCM (16-bit, 24kHz mono) to Web Audio API buffer

### Key Services

- **`services/gemini.ts`**: All Gemini interactions
  - `generateChatResponse()`: Chat with optional search grounding
  - `generateWebsiteSummary()`: URL fallback when scraping fails
  - `generateSpeech()`: TTS via `gemini-2.5-flash-preview-tts` with "Kore" voice

- **`services/audio.ts`**: PCM audio handling
  - Decodes base64 → Int16 → Float32 for Web Audio API
  - Fixed 24kHz sample rate (Gemini TTS output format)

- **`services/scraper.ts`**: Uses `api.allorigins.win` CORS proxy (demo only)

### State Machine

App uses `AppState` enum (`types.ts`):
- `IDLE` → Initial URL input screen
- `SCRAPING` → Loading spinner while fetching/analyzing
- `CHATTING` → Voice/text conversation interface

### Component Structure

```
App.tsx              # Main controller, state management, message handling
├── VoiceInput.tsx   # Mic button, Speech Recognition API wrapper
└── Waveform.tsx     # Animated audio visualizer bars
```

## Technical Notes

- Uses Tailwind CSS via CDN in `index.html` (not installed locally)
- React 19 with StrictMode enabled
- TypeScript strict mode
- No testing framework configured
- Speech recognition only works in Chrome-based browsers (webkitSpeechRecognition)
