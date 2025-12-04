# SMEC AI website chat Chat Project

## Project Overview

**SMEC AI website chat Chat** is a React-based web application that allows users to have voice conversations with the content of any website. It leverages Google's Gemini models for understanding web content, generating responses, and synthesizing speech.

### Key Features
*   **URL Analysis:** Users input a URL, which is scraped to extract text content.
*   **Hybrid Grounding:**
    *   **Scraping:** Attempts to directly scrape text using a proxy (`api.allorigins.win`).
    *   **Search Grounding:** If scraping fails, it gracefully falls back to Gemini's Google Search tool to find information about the URL.
*   **Voice Interface:**
    *   **Speech-to-Text:** Users can speak their queries (likely using Web Speech API).
    *   **Text-to-Speech (TTS):** Responses are read aloud using the `gemini-2.5-flash-preview-tts` model.
*   **Visual Feedback:** Includes audio visualization (Waveform) and citation links for grounded responses.

## Architecture & Tech Stack

*   **Frontend Framework:** React 19
*   **Build Tool:** Vite
*   **Language:** TypeScript
*   **AI & API:**
    *   `@google/genai` SDK
    *   Models: `gemini-2.5-flash` (Text/Search), `gemini-2.5-flash-preview-tts` (Audio)
*   **Styling:** Tailwind CSS (inferred from class names)

### Key Files
*   **`App.tsx`**: Main application controller. Manages states (`IDLE`, `SCRAPING`, `CHATTING`), handles user input, and coordinates services.
*   **`services/gemini.ts`**: Interface for the Gemini API. Handles:
    *   Chat generation with system instructions.
    *   Google Search Grounding configuration.
    *   Text-to-Speech generation (`generateSpeech`).
*   **`services/scraper.ts`**: Client-side scraping logic using a CORS proxy to fetch and parse HTML content.
*   **`components/VoiceInput.tsx`**: Component handling microphone input and transcription.
*   **`components/Waveform.tsx`**: Visualizer for audio output.

## Building and Running

### Prerequisites
*   Node.js installed.
*   A valid Gemini API Key.

### Setup
1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Create a `.env.local` file in the root directory and add your API key:
    ```env
    GEMINI_API_KEY=your_actual_api_key_here
    ```
    *(Note: The code references `process.env.API_KEY`, ensure your Vite config or env loading aligns with this, typically `VITE_API_KEY` for client-side exposure or proper proxying)*.

### Commands
*   **Start Development Server:**
    ```bash
    npm run dev
    ```
*   **Build for Production:**
    ```bash
    npm run build
    ```
*   **Preview Production Build:**
    ```bash
    npm run preview
    ```

## Development Conventions

*   **State Management:** Local state (`useState`) within `App.tsx` drives the simple application flow.
*   **Service Pattern:** Logic for external APIs (Gemini, Scraping) is encapsulated in the `services/` directory.
*   **Type Safety:** TypeScript interfaces are used (e.g., `Message`, `AppState`, `ScrapedData` in `types.ts`).
*   **Error Handling:** The app implements fallbacks (e.g., scraping -> search grounding) to ensure robustness.
