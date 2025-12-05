import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  isProcessing: boolean;
  onListeningChange?: (isListening: boolean) => void;
}

export interface VoiceInputRef {
  startListening: () => void;
  stopListening: () => void;
}

const VoiceInput = forwardRef<VoiceInputRef, VoiceInputProps>(({ onTranscript, isProcessing, onListeningChange }, ref) => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    startListening: () => {
      // Allow starting even during processing (for interrupt capability)
      if (recognitionRef.current && !isListening) {
        setError(null);
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch (e) {
          // May fail if already started
          console.error("Failed to start recognition:", e);
        }
      }
    },
    stopListening: () => {
      if (recognitionRef.current && isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
      }
    }
  }));

  // Notify parent of listening state changes
  useEffect(() => {
    onListeningChange?.(isListening);
  }, [isListening, onListeningChange]);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-AU'; // Australian English

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        onTranscript(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setError("Microphone error.");
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    } else {
      setError("Not supported");
    }
  }, [onTranscript]);

  const toggleListening = () => {
    // Allow toggling even during processing (for interrupt capability)
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setError(null);
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error("Failed to start recognition:", e);
      }
    }
  };

  return (
    <div className="flex items-center relative">
      <button
        onClick={toggleListening}
        disabled={!!error && error !== "Microphone error."}
        title={error || (isListening ? "Stop listening" : "Tap to speak or interrupt")}
        className={`
          p-4 rounded-full transition-all duration-200 flex items-center justify-center shadow-lg
          ${isListening
            ? 'bg-green-500 text-white ring-4 ring-green-300 animate-pulse scale-110'
            : 'bg-primary text-white hover:bg-primary/90 hover:scale-105'
          }
        `}
      >
        {isListening ? (
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
        ) : (
           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" x2="12" y1="19" y2="22"/>
          </svg>
        )}
      </button>
    </div>
  );
});

VoiceInput.displayName = 'VoiceInput';

export default VoiceInput;