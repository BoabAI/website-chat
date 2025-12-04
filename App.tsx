import React, { useState, useEffect, useRef } from 'react';
import { scrapeWebsite } from './services/scraper';
import { generateChatResponse, generateSpeech, generateWebsiteSummary } from './services/gemini';
import { playAudioData } from './services/audio';
import { AppState, Message, ScrapedData } from './types';
import VoiceInput from './components/VoiceInput';
import Waveform from './components/Waveform';

const App = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [url, setUrl] = useState('');
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [currentAudioSource, setCurrentAudioSource] = useState<AudioBufferSourceNode | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setAppState(AppState.SCRAPING);
    try {
      const data = await scrapeWebsite(url);
      setScrapedData(data);

      let initialMessage: Message;

      if (data.success) {
        initialMessage = {
          role: 'model',
          text: `I've analyzed the content of ${data.title}. What would you like to know?`,
          timestamp: Date.now()
        };
      } else {
        // Fallback: If scraping fails, use Gemini Search Grounding to generate a summary
        const summaryResponse = await generateWebsiteSummary(url);
        initialMessage = {
          role: 'model',
          text: summaryResponse.text,
          timestamp: Date.now(),
          groundingSources: summaryResponse.groundingSources
        };
      }

      setMessages([initialMessage]);
      setAppState(AppState.CHATTING);

      // Auto-speak welcome message
      handleSpeakResponse(initialMessage.text);

    } catch (error) {
      console.error(error);
      setAppState(AppState.IDLE);
      alert("Failed to process URL. Please try again.");
    }
  };

  const stopCurrentAudio = () => {
    if (currentAudioSource) {
      try {
        currentAudioSource.stop();
      } catch (e) {
        // Ignore errors if already stopped
      }
      setCurrentAudioSource(null);
      setIsPlayingAudio(false);
    }
  };

  const handleSpeakResponse = async (text: string) => {
    stopCurrentAudio(); // Stop any previous speech
    setIsPlayingAudio(true);
    const audioBase64 = await generateSpeech(text);
    if (audioBase64) {
      const source = await playAudioData(audioBase64, () => {
        setIsPlayingAudio(false);
        setCurrentAudioSource(null);
      });
      setCurrentAudioSource(source);
    } else {
      setIsPlayingAudio(false);
    }
  };

  const handleUserMessage = async (text: string) => {
    if (!text.trim() || isProcessing) return;

    stopCurrentAudio(); // Interrupt model if user speaks

    const userMsg: Message = { role: 'user', text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setIsProcessing(true);
    setInputText('');

    // Prepare context: Scraped content + history
    const context = scrapedData?.success ? scrapedData.content : "";
    const history = messages.map(m => ({ role: m.role, text: m.text }));

    const response = await generateChatResponse(text, context, history);

    const modelMsg: Message = {
      role: 'model',
      text: response.text,
      timestamp: Date.now(),
      groundingSources: response.groundingSources
    };

    setMessages(prev => [...prev, modelMsg]);
    setIsProcessing(false);

    // Speak the response
    handleSpeakResponse(response.text);
  };

  const resetApp = () => {
    stopCurrentAudio();
    setAppState(AppState.IDLE);
    setMessages([]);
    setScrapedData(null);
    setUrl('');
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center">

      {/* Header */}
      <header className="w-full p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/90 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-400 to-blue-600 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            </svg>
          </div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">
            SMEC AI website chat
          </h1>
        </div>
        {appState === AppState.CHATTING && (
          <button
            onClick={resetApp}
            className="text-sm text-slate-400 hover:text-white transition-colors"
          >
            Change URL
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-2xl p-4 flex flex-col relative">

        {appState === AppState.IDLE && (
          <div className="flex-1 flex flex-col justify-center items-center gap-8 animate-in fade-in zoom-in duration-500">
            <div className="text-center space-y-4 max-w-md">
              <h2 className="text-4xl font-bold tracking-tight">Chat with the Web</h2>
              <p className="text-slate-400 text-lg">
                Enter a URL to start a voice conversation with its content, powered by Gemini Search Grounding.
              </p>
            </div>

            <form onSubmit={handleUrlSubmit} className="w-full max-w-md relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-blue-600 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
              <div className="relative flex">
                <input
                  type="url"
                  placeholder="https://example.com"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-slate-800 text-white placeholder-slate-500 border border-slate-700 rounded-l-lg px-4 py-4 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                />
                <button
                  type="submit"
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold px-6 py-4 rounded-r-lg transition-colors"
                >
                  Start
                </button>
              </div>
            </form>
          </div>
        )}

        {appState === AppState.SCRAPING && (
          <div className="flex-1 flex flex-col justify-center items-center gap-4">
            <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 animate-pulse">Analyzing website content...</p>
          </div>
        )}

        {appState === AppState.CHATTING && (
          <div className="flex-1 flex flex-col h-full overflow-hidden">

             {/* Website Info Badge */}
             <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 mb-4 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="bg-slate-700 p-1 rounded">🌐</span>
                  <span className="truncate font-medium text-slate-300">{scrapedData?.title || url}</span>
                </div>
                {!scrapedData?.success && (
                  <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">
                    Search Grounding Active
                  </span>
                )}
             </div>

             {/* Messages */}
             <div className="flex-1 overflow-y-auto space-y-6 pr-2 pb-32">
               {messages.map((msg, idx) => (
                 <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`
                      max-w-[85%] rounded-2xl px-5 py-3
                      ${msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-tr-none'
                        : 'bg-slate-800 text-slate-200 rounded-tl-none border border-slate-700'}
                    `}>
                      <p className="leading-relaxed">{msg.text}</p>
                    </div>
                    {/* Grounding Sources (Citations) */}
                    {msg.role === 'model' && msg.groundingSources && msg.groundingSources.length > 0 && (
                      <div className="mt-2 max-w-[85%] flex flex-wrap gap-2">
                        {msg.groundingSources.map((source, i) => (
                          <a
                            key={i}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] bg-slate-800/80 hover:bg-slate-800 text-cyan-400 border border-slate-700 hover:border-cyan-500/50 px-2 py-1 rounded-md flex items-center gap-1.5 transition-all group"
                          >
                            <span className="truncate max-w-[150px] font-medium">{source.title}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 group-hover:opacity-100"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                          </a>
                        ))}
                      </div>
                    )}
                 </div>
               ))}
               {isProcessing && (
                  <div className="flex justify-start">
                    <div className="bg-slate-800 rounded-2xl rounded-tl-none px-5 py-4 border border-slate-700 flex gap-1">
                      <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-100"></div>
                      <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-200"></div>
                    </div>
                  </div>
               )}
               <div ref={messagesEndRef} />
             </div>

             {/* Controls Overlay */}
             <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900 via-slate-900 to-transparent pt-12 pb-4 px-4 flex flex-col items-center gap-4">

                {/* Visualizer for TTS Output */}
                {isPlayingAudio && (
                  <div className="absolute -top-8 flex flex-col items-center gap-1">
                    <Waveform isActive={true} />
                    <span className="text-xs text-cyan-400 font-medium tracking-wider uppercase">Speaking</span>
                  </div>
                )}

                {/* Input Area */}
                <div className="w-full flex items-end gap-3 max-w-xl">
                  {/* Voice Button */}
                  <VoiceInput onTranscript={handleUserMessage} isProcessing={isProcessing} />

                  {/* Text Fallback */}
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUserMessage(inputText)}
                      placeholder="Type a message..."
                      disabled={isProcessing}
                      className="w-full bg-slate-800/80 backdrop-blur border border-slate-600 rounded-full pl-5 pr-12 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all disabled:opacity-50"
                    />
                    <button
                      onClick={() => handleUserMessage(inputText)}
                      disabled={!inputText.trim() || isProcessing}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-slate-700 rounded-full text-slate-300 hover:text-white hover:bg-cyan-600 transition-colors disabled:opacity-0"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"></line>
                        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                      </svg>
                    </button>
                  </div>
                </div>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
