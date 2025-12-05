import React, { useState, useRef, useEffect, useCallback } from 'react';
import { scrapeWebsite } from './services/scraper';
import { generateWebsiteSummary } from './services/gemini';
import { AppState, Message } from './types';
import { useGeminiSession } from './hooks/useGeminiSession';
import { SYSTEM_PROMPTS } from './config/constants';
import Waveform from './components/Waveform';
import SmecLogo from './components/SmecLogo';

const App = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [url, setUrl] = useState('');
  const [siteTitle, setSiteTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleMessageAdded = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const {
    isListening,
    isSpeaking,
    initSession,
    toggleListening,
    sendTextMessage,
    resetSession,
    sessionRef
  } = useGeminiSession({ onMessageAdded: handleMessageAdded });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setAppState(AppState.SCRAPING);

    try {
      const data = await scrapeWebsite(url);
      let context = '';
      let title = '';

      if (data.success) {
        context = data.content;
        title = data.title;
        setSiteTitle(data.title);
      } else {
        const summary = await generateWebsiteSummary(url);
        title = url;
        setSiteTitle(url);
        // Add summary as first message
        setMessages([{
          role: 'model',
          text: summary.text,
          timestamp: Date.now(),
          groundingSources: summary.groundingSources
        }]);
      }

      setAppState(AppState.CHATTING);

      const systemPrompt = SYSTEM_PROMPTS.CHAT_BASE.replace('{{context}}', context || "Answer based on your knowledge.");
      await initSession(systemPrompt);
      
      // We don't strictly need to initMic here as it lazy loads on startListening

      // Make AI greet user
      setTimeout(() => {
        const greetingPrompt = data.success
          ? SYSTEM_PROMPTS.GREETING_SUCCESS(title)
          : SYSTEM_PROMPTS.GREETING_FALLBACK(url);
        
        sessionRef.current?.sendText(greetingPrompt);
      }, 500);

    } catch (error) {
      console.error(error);
      setAppState(AppState.IDLE);
      // Consider a toast here instead of alert in future
      alert("Failed to process URL");
    }
  };

  const handleTextSubmit = () => {
    if (!inputText.trim()) return;
    sendTextMessage(inputText);
    setInputText('');
  };

  const reset = () => {
    resetSession();
    setAppState(AppState.IDLE);
    setMessages([]);
    setUrl('');
    setSiteTitle('');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Header */}
      <header className="w-full px-6 py-4 shadow-sm flex justify-between items-center bg-white border-b sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <SmecLogo className="h-9" />
          <div className="h-6 w-px bg-gray-300" />
          <span className="text-gray-500 font-medium text-sm">Website Chat</span>
        </div>
        {appState === AppState.CHATTING && (
          <button onClick={reset} className="text-sm text-gray-500 hover:text-primary">
            Change URL
          </button>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col">
        {appState === AppState.IDLE && (
          <div className="flex-1 flex flex-col justify-center items-center gap-10">
            <div className="text-center space-y-6 max-w-xl">
              <h2 className="text-5xl font-bold text-primary">Chat with the Web</h2>
              <p className="text-gray-600 text-xl">
                Enter a URL to start a real-time voice conversation.
              </p>
            </div>
            <form onSubmit={handleSubmit} className="w-full max-w-lg shadow-xl rounded-lg">
              <div className="flex">
                <input
                  type="url"
                  placeholder="https://example.com"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 bg-white border border-gray-200 rounded-l-lg px-6 py-5 focus:outline-none focus:ring-2 focus:ring-primary text-lg"
                />
                <button type="submit" className="bg-secondary hover:bg-violet-700 text-white font-bold px-8 py-5 rounded-r-lg text-lg">
                  Start
                </button>
              </div>
            </form>
          </div>
        )}

        {appState === AppState.SCRAPING && (
          <div className="flex-1 flex flex-col justify-center items-center gap-6">
            <div className="w-16 h-16 border-4 border-gray-200 border-t-primary rounded-full animate-spin" />
            <p className="text-gray-600 font-medium animate-pulse">Analyzing website...</p>
          </div>
        )}

        {appState === AppState.CHATTING && (
          <div className="flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm border my-4">
            {/* Site Info */}
            <div className="bg-gray-50 border-b p-4 flex items-center gap-2 text-sm">
              <span className="text-lg">🌐</span>
              <a href={url} target="_blank" rel="noreferrer" className="truncate font-semibold text-primary hover:underline">
                {siteTitle || url}
              </a>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-6 p-6 pb-32 bg-gray-50/50">
              {messages.map((msg, i) => (
                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-6 py-4 shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-white rounded-br-sm'
                      : 'bg-white text-gray-800 rounded-bl-sm border'
                  }`}>
                    <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                  {msg.groundingSources && msg.groundingSources.length > 0 && (
                    <div className="mt-3 max-w-[85%] flex flex-wrap gap-2">
                      {msg.groundingSources.map((src, j) => (
                        <a key={j} href={src.uri} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-white hover:bg-gray-50 text-primary border px-3 py-1.5 rounded-full">
                          {src.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Controls */}
            <div className="absolute bottom-4 left-4 right-4 flex flex-col items-center gap-4">
              {(isListening || isSpeaking) && (
                <div className={`${isSpeaking ? 'bg-primary/90' : 'bg-green-500/90'} backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-3 shadow-lg`}>
                  <Waveform isActive={true} barColor="bg-white" />
                  <span className="text-xs text-white font-bold uppercase">
                    {isSpeaking ? 'Speaking' : 'Listening'}
                  </span>
                </div>
              )}

              <div className="w-full flex items-end gap-3 max-w-2xl bg-white p-2 rounded-full shadow-xl border">
                <button
                  onClick={toggleListening}
                  className={`p-4 rounded-full transition-all shadow-lg ml-1 ${
                    isListening
                      ? 'bg-green-500 text-white ring-4 ring-green-300 animate-pulse'
                      : 'bg-primary text-white hover:bg-primary/90'
                  }`}
                  aria-label={isListening ? "Stop Listening" : "Start Listening"}
                >
                  {isListening ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                  )}
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
                  placeholder="Type your message..."
                  className="flex-1 bg-transparent px-4 py-3 focus:outline-none text-lg"
                />

                <button
                  onClick={handleTextSubmit}
                  disabled={!inputText.trim()}
                  className="p-3 bg-secondary hover:bg-violet-700 rounded-full text-white disabled:opacity-50 mr-1"
                  aria-label="Send Message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;