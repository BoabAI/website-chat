import { useState, useRef, useEffect, useCallback } from 'react';
import { createLiveSession, LiveSession } from '../services/geminiLive';
import { createMicrophoneStream, MicrophoneStream } from '../services/microphone';
import { playAudioChunk, stopAudio, resetAudioTiming, waitForAudioEnd } from '../services/audio';
import { Message } from '../types';

interface UseGeminiSessionProps {
  onMessageAdded: (message: Message) => void;
}

export const useGeminiSession = ({ onMessageAdded }: UseGeminiSessionProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const sessionRef = useRef<LiveSession | null>(null);
  const micRef = useRef<MicrophoneStream | null>(null);
  const userTextRef = useRef('');
  const modelTextRef = useRef('');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      micRef.current?.stop();
      stopAudio();
    };
  }, []);

  const startListening = useCallback(async () => {
    if (!micRef.current) {
      micRef.current = createMicrophoneStream(
        (audio) => sessionRef.current?.sendAudio(audio),
        (error) => console.error('Mic error:', error)
      );
    }

    if (!micRef.current?.isActive()) {
      userTextRef.current = '';
      await micRef.current?.start();
      setIsListening(true);
    }
  }, []);

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    setIsListening(false);

    // Add user message if we have accumulated text
    if (userTextRef.current.trim()) {
        onMessageAdded({
        role: 'user',
        text: userTextRef.current.trim(),
        timestamp: Date.now()
      });
      userTextRef.current = '';
      resetAudioTiming();
    }
  }, [onMessageAdded]);

  const initSession = useCallback(async (systemPrompt: string) => {
    sessionRef.current?.close();

    sessionRef.current = await createLiveSession(systemPrompt, {
      onAudio: (audio) => {
        if (!isSpeaking) setIsSpeaking(true);
        playAudioChunk(audio);
      },
      onUserText: (text) => {
        userTextRef.current += text;
      },
      onModelText: (text) => {
        modelTextRef.current += text;
      },
      onTurnComplete: async () => {
        // Add model message
        if (modelTextRef.current.trim()) {
          onMessageAdded({
            role: 'model',
            text: modelTextRef.current.trim(),
            timestamp: Date.now()
          });
          modelTextRef.current = '';
        }
        
        // Wait for audio to finish playing before listening
        await waitForAudioEnd();
        
        setIsSpeaking(false);

        // Auto-restart listening with a small buffer
        setTimeout(() => startListening(), 100);
      },
      onError: (error) => {
        console.error('Session error:', error);
        setIsSpeaking(false);
      }
    });
  }, [isSpeaking, onMessageAdded, startListening]);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      stopListening();
    } else {
      stopAudio();
      setIsSpeaking(false);
      await startListening();
    }
  }, [isListening, stopListening, startListening]);

  const sendTextMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    onMessageAdded({ role: 'user', text, timestamp: Date.now() });
    stopListening();
    stopAudio();
    resetAudioTiming();
    sessionRef.current?.sendText(text);
  }, [onMessageAdded, stopListening]);

  const resetSession = useCallback(() => {
    stopListening();
    stopAudio();
    sessionRef.current?.close();
    sessionRef.current = null;
    micRef.current = null;
    setIsSpeaking(false);
  }, [stopListening]);

  return {
    isListening,
    isSpeaking,
    initSession,
    startListening,
    stopListening,
    toggleListening,
    sendTextMessage,
    resetSession,
    sessionRef // Exposed if absolutely needed, but try to avoid
  };
};
