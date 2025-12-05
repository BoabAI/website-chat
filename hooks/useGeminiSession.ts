import { useState, useRef, useEffect, useCallback } from 'react';
import { createLiveSession, LiveSession } from '../services/geminiLive';
import { createMicrophoneStream, MicrophoneStream } from '../services/microphone';
import { playAudioChunk, stopAudio, resetAudioTiming, waitForAudioEnd } from '../services/audio';
import { Message } from '../types';

interface UseGeminiSessionProps {
  onMessageAdded: (message: Message) => void;
  onMessageUpdated: (timestamp: number, text: string) => void;
}

export const useGeminiSession = ({ onMessageAdded, onMessageUpdated }: UseGeminiSessionProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const sessionRef = useRef<LiveSession | null>(null);
  const micRef = useRef<MicrophoneStream | null>(null);
  const userTextRef = useRef('');
  const modelTextRef = useRef('');
  const modelMessageTimestampRef = useRef<number | null>(null);
  const audioSentRef = useRef(false); // Track if we sent any audio this turn
  const systemPromptRef = useRef<string>(''); // Store for reconnection

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      micRef.current?.stop();
      stopAudio();
    };
  }, []);

  // Forward declaration - will be set after initSessionInternal is defined
  const startListeningRef = useRef<() => Promise<void>>();

  const createStartListening = useCallback((reconnectFn: (prompt: string) => Promise<void>) => {
    return async () => {
      console.log('[startListening] Called, isConnected:', sessionRef.current?.isConnected());

      // Check if session is still connected, reconnect if needed
      if (!sessionRef.current?.isConnected()) {
        console.log('[startListening] Session disconnected, reconnecting...');
        if (systemPromptRef.current) {
          await reconnectFn(systemPromptRef.current);
          console.log('[startListening] Reconnected, isConnected:', sessionRef.current?.isConnected());
        } else {
          console.warn('[startListening] No system prompt stored, cannot reconnect');
          return;
        }
      }

      if (!micRef.current) {
        console.log('[startListening] Creating new microphone stream');
        micRef.current = createMicrophoneStream(
          (audio) => {
            if (!audioSentRef.current) {
              console.log('[startListening] First audio chunk sent');
            }
            audioSentRef.current = true;
            sessionRef.current?.sendAudio(audio);
          },
          (error) => console.error('Mic error:', error)
        );
      }

      if (!micRef.current?.isActive()) {
        console.log('[startListening] Starting microphone...');
        userTextRef.current = '';
        audioSentRef.current = false;
        setIsListening(true);
        await micRef.current?.start();
        if (!micRef.current?.isActive()) {
          console.log('[startListening] Mic failed to start');
          setIsListening(false);
        } else {
          console.log('[startListening] Mic started successfully');
        }
      } else {
        console.log('[startListening] Mic already active');
      }
    };
  }, []);

  const startListening = useCallback(async () => {
    if (startListeningRef.current) {
      await startListeningRef.current();
    }
  }, []);

  const stopListening = useCallback(async () => {
    console.log('[stopListening] Called, audioSent:', audioSentRef.current, 'isConnected:', sessionRef.current?.isConnected());
    setIsListening(false);

    // Wait for mic to fully stop and flush remaining audio
    await micRef.current?.stop();
    console.log('[stopListening] Mic stopped');

    // Only end turn if we actually sent audio
    if (audioSentRef.current) {
      console.log('[stopListening] Ending turn...');
      sessionRef.current?.endTurn();
      audioSentRef.current = false;
    } else {
      console.log('[stopListening] No audio sent, skipping endTurn');
    }

    // Add user message if we have accumulated text
    if (userTextRef.current.trim()) {
      console.log('[stopListening] Adding user message:', userTextRef.current.trim());
      onMessageAdded({
        role: 'user',
        text: userTextRef.current.trim(),
        timestamp: Date.now()
      });
      userTextRef.current = '';
      resetAudioTiming();
    }
  }, [onMessageAdded]);

  // Internal session creation (used for initial and reconnection)
  const initSessionInternal = useCallback(async (systemPrompt: string) => {
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

        // Create message on first chunk, update on subsequent chunks
        if (!modelMessageTimestampRef.current) {
          const timestamp = Date.now();
          modelMessageTimestampRef.current = timestamp;
          onMessageAdded({
            role: 'model',
            text: modelTextRef.current,
            timestamp
          });
        } else {
          onMessageUpdated(modelMessageTimestampRef.current, modelTextRef.current);
        }
      },
      onTurnComplete: async () => {
        // If there's pending user text, add it to messages before model's response
        if (userTextRef.current.trim()) {
          onMessageAdded({
            role: 'user',
            text: userTextRef.current.trim(),
            timestamp: Date.now()
          });
          userTextRef.current = '';
        }

        // Model message already added via streaming, just reset refs
        modelTextRef.current = '';
        modelMessageTimestampRef.current = null;

        // Wait for audio to finish playing
        await waitForAudioEnd();

        setIsSpeaking(false);
        // Push-to-talk: User manually holds button to talk, no auto-restart
      },
      onError: (error) => {
        console.error('Session error:', error);
        setIsSpeaking(false);
      }
    });
  }, [isSpeaking, onMessageAdded, onMessageUpdated]);

  // Set up startListening with reconnect capability
  useEffect(() => {
    startListeningRef.current = createStartListening(initSessionInternal);
  }, [createStartListening, initSessionInternal]);

  // Public init that also stores the prompt for reconnection
  const initSession = useCallback(async (systemPrompt: string) => {
    systemPromptRef.current = systemPrompt;
    await initSessionInternal(systemPrompt);
  }, [initSessionInternal]);

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
