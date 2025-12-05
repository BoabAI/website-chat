import React, { useState, useEffect, useRef } from 'react';
import { scrapeWebsite } from './services/scraper';
import { generateChatResponse, generateSpeech, generateWebsiteSummary } from './services/gemini';
import { playAudioData } from './services/audio';
import { AppState, Message, ScrapedData } from './types';
import VoiceInput, { VoiceInputRef } from './components/VoiceInput';
import Waveform from './components/Waveform';

const App = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [url, setUrl] = useState('');
  const [scrapedData, setScrapedData] = useState<ScrapedData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true); // Auto-listen after AI speaks
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const voiceInputRef = useRef<VoiceInputRef>(null);
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

    setIsGeneratingAudio(true); // Show "Processing" indicator
    const audioBase64 = await generateSpeech(text);
    setIsGeneratingAudio(false); // Hide "Processing" indicator

    if (audioBase64) {
      const source = await playAudioData(
        audioBase64,
        () => {
          // onEnded: Audio finished playing
          setIsPlayingAudio(false);
          setCurrentAudioSource(null);

          // Auto-start listening for next user input if continuous mode is on
          if (continuousMode) {
            setTimeout(() => {
              voiceInputRef.current?.startListening();
            }, 300); // Small delay for better UX
          }
        },
        () => {
          // onStarted: Audio actually started playing - NOW show the indicator
          setIsPlayingAudio(true);
        }
      );
      setCurrentAudioSource(source);
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
    setIsGeneratingAudio(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col items-center font-sans">

      {/* Header */}
      <header className="w-full p-6 shadow-md flex justify-between items-center bg-primary sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded flex items-center justify-center">
            {/* Simple logo placeholder matching SMEC AI branding style */}
             <span className="text-primary font-bold text-lg">S</span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            SMEC AI <span className="font-light opacity-80">Website Chat</span>
          </h1>
        </div>
        {appState === AppState.CHATTING && (
          <button
            onClick={resetApp}
            className="text-sm text-white/80 hover:text-white transition-colors underline decoration-secondary/0 hover:decoration-secondary decoration-2 underline-offset-4"
          >
            Change URL
          </button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-3xl p-4 flex flex-col relative">

        {appState === AppState.IDLE && (
          <div className="flex-1 flex flex-col justify-center items-center gap-10 animate-in fade-in zoom-in duration-500">
            <div className="text-center space-y-6 max-w-xl">
              <h2 className="text-5xl font-bold tracking-tight text-primary">Chat with the Web</h2>
              <p className="text-gray-600 text-xl leading-relaxed">
                Enter a website URL to start a voice conversation with its content.
              </p>
            </div>

            <form onSubmit={handleUrlSubmit} className="w-full max-w-lg relative shadow-xl rounded-lg">
              <div className="relative flex">
                <input
                  type="url"
                  placeholder="https://example.com"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full bg-white text-gray-900 placeholder-gray-400 border border-gray-200 rounded-l-lg px-6 py-5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-lg"
                />
                <button
                  type="submit"
                  className="bg-secondary hover:bg-violet-700 text-white font-bold px-8 py-5 rounded-r-lg transition-colors text-lg"
                >
                  Start
                </button>
              </div>
            </form>
          </div>
        )}

        {appState === AppState.SCRAPING && (
          <div className="flex-1 flex flex-col justify-center items-center gap-6">
            <div className="w-16 h-16 border-4 border-gray-200 border-t-primary rounded-full animate-spin"></div>
            <p className="text-gray-600 font-medium animate-pulse">Analyzing website content...</p>
          </div>
        )}

        {appState === AppState.CHATTING && (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200 my-4">

             {/* Website Info Badge */}
             <div className="bg-gray-50 border-b border-gray-100 p-4 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="bg-white p-1.5 rounded shadow-sm text-lg">🌐</span>
                  <a href={url} target="_blank" rel="noreferrer" className="truncate font-semibold text-primary hover:underline">
                    {scrapedData?.title || url}
                  </a>
                </div>
                {!scrapedData?.success && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    Search Grounding Active
                  </span>
                )}
             </div>

             {/* Messages */}
             <div className="flex-1 overflow-y-auto space-y-6 p-6 pb-32 bg-gray-50/50">
               {messages.map((msg, idx) => (
                 <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`
                      max-w-[85%] rounded-2xl px-6 py-4 shadow-sm text-base
                      ${msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-sm'
                        : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'}
                    `}>
                      <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                    </div>
                    {/* Grounding Sources (Citations) */}
                    {msg.role === 'model' && msg.groundingSources && msg.groundingSources.length > 0 && (
                      <div className="mt-3 max-w-[85%] flex flex-wrap gap-2">
                        {msg.groundingSources.map((source, i) => (
                          <a
                            key={i}
                            href={source.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-white hover:bg-gray-50 text-primary border border-gray-200 hover:border-primary px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-all shadow-sm"
                          >
                            <span className="truncate max-w-[150px] font-medium">{source.title}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                          </a>
                        ))}
                      </div>
                    )}
                 </div>
               ))}
               {isProcessing && (
                  <div className="flex justify-start">
                    <div className="bg-white rounded-2xl rounded-bl-sm px-6 py-4 border border-gray-100 shadow-sm flex gap-1.5">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200"></div>
                    </div>
                  </div>
               )}
               <div ref={messagesEndRef} />
             </div>

             {/* Controls Overlay */}
             <div className="absolute bottom-4 left-4 right-4 flex flex-col items-center gap-4">

                {/* Processing indicator - shown while generating TTS */}
                {isGeneratingAudio && !isPlayingAudio && (
                  <div className="bg-orange-500/90 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-3 shadow-lg mb-2 animate-in slide-in-from-bottom-4 fade-in">
                    <Waveform isActive={true} barColor="bg-white" />
                    <span className="text-xs text-white font-bold tracking-wider uppercase">Please wait</span>
                  </div>
                )}

                {/* Visualizer for TTS Output */}
                {isPlayingAudio && (
                  <div className="bg-primary/90 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-3 shadow-lg mb-2 animate-in slide-in-from-bottom-4 fade-in">
                    <Waveform isActive={true} barColor="bg-white" />
                    <span className="text-xs text-white font-bold tracking-wider uppercase">Speaking</span>
                  </div>
                )}

                {/* Listening indicator - shown when waiting for user speech */}
                {isListening && !isProcessing && !isPlayingAudio && !isGeneratingAudio && (
                  <div className="bg-green-500/90 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-3 shadow-lg mb-2 animate-in slide-in-from-bottom-4 fade-in">
                    <Waveform isActive={true} barColor="bg-white" />
                    <span className="text-xs text-white font-bold tracking-wider uppercase">Listening</span>
                  </div>
                )}

                {/* Input Area */}
                <div className="w-full flex items-end gap-3 max-w-2xl bg-white p-2 rounded-full shadow-xl border border-gray-200">
                  {/* Voice Button */}
                  <div className="pl-1">
                    <VoiceInput
                      ref={voiceInputRef}
                      onTranscript={handleUserMessage}
                      isProcessing={isProcessing}
                      onListeningChange={setIsListening}
                    />
                  </div>

                  {/* Text Fallback */}
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUserMessage(inputText)}
                      placeholder="Type your message..."
                      disabled={isProcessing}
                      className="w-full bg-transparent text-gray-800 placeholder-gray-400 px-4 py-3 focus:outline-none text-lg"
                    />
                  </div>
                  
                  <button
                    onClick={() => handleUserMessage(inputText)}
                    disabled={!inputText.trim() || isProcessing}
                    className="p-3 bg-secondary hover:bg-violet-700 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed mr-1"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
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