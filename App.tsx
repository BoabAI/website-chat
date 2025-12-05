import React, { useState, useRef, useEffect, useCallback } from 'react';
import { scrapeWebsite } from './services/scraper';
import { generateWebsiteSummary } from './services/gemini';
import { AppState, Message } from './types';
import { useChat } from './hooks/useChat';
import Waveform from './components/Waveform';
import SmecLogo from './components/SmecLogo';

const App = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [url, setUrl] = useState('');
  const [siteTitle, setSiteTitle] = useState('');
  const [siteContext, setSiteContext] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleMessageAdded = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const {
    isListening,
    isSpeaking,
    isProcessing,
    startListening,
    stopListening,
    sendTextMessage,
    sendGreeting,
    resetChat
  } = useChat({ onMessageAdded: handleMessageAdded, context: siteContext });

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
        setSiteContext(data.content);
      } else {
        const summary = await generateWebsiteSummary(url);
        title = url;
        setSiteTitle(url);
        setSiteContext(''); // Will use search grounding
        // Add summary as first message
        setMessages([{
          role: 'model',
          text: summary.text,
          timestamp: Date.now(),
          groundingSources: summary.groundingSources
        }]);
      }

      setAppState(AppState.CHATTING);

      // Generate greeting
      const greeting = data.success
        ? `G'day! I've had a look at ${title}. How can I help you with it today?`
        : `G'day! I've researched ${url}. How can I help you today?`;

      // Small delay to let UI settle, then greet
      setTimeout(() => {
        sendGreeting(greeting);
      }, 300);

    } catch (error) {
      console.error(error);
      setAppState(AppState.IDLE);
      alert("Failed to process URL");
    }
  };

  const handleTextSubmit = () => {
    if (!inputText.trim() || isProcessing) return;
    sendTextMessage(inputText);
    setInputText('');
  };

  // Track if we're currently in a push-to-talk gesture
  const isPushingRef = useRef(false);

  const handlePushToTalkStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (isPushingRef.current || isProcessing) return;
    isPushingRef.current = true;
    startListening();
  }, [startListening, isProcessing]);

  const handlePushToTalkEnd = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isPushingRef.current) return;
    isPushingRef.current = false;
    stopListening();
  }, [stopListening]);

  const reset = () => {
    resetChat();
    setAppState(AppState.IDLE);
    setMessages([]);
    setUrl('');
    setSiteTitle('');
    setSiteContext('');
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
                Enter a URL to start a voice conversation.
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
          <div className="relative flex-1 flex flex-col overflow-hidden bg-white rounded-xl shadow-sm border my-4">
            {/* Site Info */}
            <div className="bg-gray-50 border-b p-4 flex items-center gap-2 text-sm shrink-0">
              <span className="text-lg">🌐</span>
              <a href={url} target="_blank" rel="noreferrer" className="truncate font-semibold text-primary hover:underline">
                {siteTitle || url}
              </a>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto space-y-6 p-6 pb-32 bg-gray-50/50 scroll-smooth z-0">
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
                          className="text-xs bg-white hover:bg-gray-50 text-primary border px-3 py-1.5 rounded-full transition-colors">
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
            <div className="absolute bottom-4 left-4 right-4 flex flex-col items-center gap-4 z-20 pointer-events-none">
              {(isListening || isSpeaking || isProcessing) && (
                <div className={`${isSpeaking ? 'bg-primary/90' : isProcessing ? 'bg-secondary/90' : 'bg-green-500/90'} backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-3 shadow-lg pointer-events-auto animate-in fade-in slide-in-from-bottom-4`}>
                  <Waveform isActive={true} barColor="bg-white" />
                  <span className="text-xs text-white font-bold uppercase">
                    {isSpeaking ? 'Speaking' : isProcessing ? 'Thinking' : 'Listening'}
                  </span>
                </div>
              )}

              <div className="w-full flex items-end gap-3 max-w-2xl bg-white p-2 rounded-full shadow-xl border pointer-events-auto">
                <button
                  onMouseDown={handlePushToTalkStart}
                  onMouseUp={handlePushToTalkEnd}
                  onMouseLeave={handlePushToTalkEnd}
                  onTouchStart={handlePushToTalkStart}
                  onTouchEnd={handlePushToTalkEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={isProcessing}
                  className={`p-4 rounded-full transition-all shadow-lg ml-1 shrink-0 select-none touch-none ${
                    isListening
                      ? 'bg-green-500 text-white ring-4 ring-green-300 scale-110'
                      : isProcessing
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-primary text-white hover:bg-primary/90 active:scale-95'
                  }`}
                  aria-label="Hold to talk"
                  title="Hold to talk"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
                  placeholder="Type your message..."
                  disabled={isProcessing}
                  className="flex-1 bg-transparent px-4 py-4 focus:outline-none text-lg min-w-0 disabled:opacity-50"
                />

                <button
                  onClick={handleTextSubmit}
                  disabled={!inputText.trim() || isProcessing}
                  className="p-3 bg-secondary hover:bg-violet-700 rounded-full text-white disabled:opacity-50 mr-1 shrink-0 transition-colors"
                  aria-label="Send Message"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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
