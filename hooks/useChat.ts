import { useState, useRef, useCallback } from 'react';
import { streamChatResponse, generateSpeech } from '../services/gemini';
import { playAudioChunk, stopAudio, resetAudioTiming, waitForAudioEnd } from '../services/audio';
import { Message } from '../types';

interface UseChatProps {
  onMessageAdded: (message: Message) => void;
  onMessageUpdated?: (timestamp: number, text: string) => void;
  context: string;
}

interface QueuedAudio {
  sentence: string;
  audioPromise: Promise<string | null>;
}

export const useChat = ({ onMessageAdded, onMessageUpdated, context }: UseChatProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const recognitionRef = useRef<any>(null);
  const historyRef = useRef<{ role: string; text: string }[]>([]);

  // Audio queue with prefetched TTS
  const audioQueueRef = useRef<QueuedAudio[]>([]);
  const isPlayingQueueRef = useRef(false);
  const abortRef = useRef(false);
  const hasStartedSpeakingRef = useRef(false);

  // For streaming text updates
  const currentMessageRef = useRef<{ timestamp: number; text: string } | null>(null);

  // Process audio queue - plays prefetched audio sequentially
  const processAudioQueue = useCallback(async () => {
    if (isPlayingQueueRef.current) return;
    isPlayingQueueRef.current = true;

    while (audioQueueRef.current.length > 0 && !abortRef.current) {
      const item = audioQueueRef.current.shift()!;
      console.log('[useChat] Playing:', item.sentence.substring(0, 50) + '...');

      try {
        // Audio was already being fetched (prefetched), now await it
        const audioBase64 = await item.audioPromise;
        if (audioBase64 && !abortRef.current) {
          // First audio ready - switch from processing to speaking
          if (!hasStartedSpeakingRef.current) {
            hasStartedSpeakingRef.current = true;
            setIsProcessing(false);
            setIsSpeaking(true);
          }
          playAudioChunk(audioBase64);
          await waitForAudioEnd();
        }
      } catch (error) {
        console.error('[useChat] Audio playback error:', error);
      }
    }

    isPlayingQueueRef.current = false;
    if (!abortRef.current) {
      setIsSpeaking(false);
    }
  }, []);

  // Queue sentence with immediate TTS prefetch
  const queueSentenceForSpeech = useCallback((sentence: string) => {
    if (abortRef.current) return;

    console.log('[useChat] Prefetching TTS for:', sentence.substring(0, 50) + '...');

    // Start TTS generation immediately (prefetch)
    const audioPromise = generateSpeech(sentence);

    audioQueueRef.current.push({ sentence, audioPromise });

    // Start processing queue if not already running
    processAudioQueue();
  }, [processAudioQueue]);

  // Initialize speech recognition
  const initRecognition = useCallback(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.error('Speech recognition not supported');
      return null;
    }

    const SpeechRecognition = (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-AU';

    return recognition;
  }, []);

  // Process user speech with STREAMING response
  const processUserInput = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;

    console.log('[useChat] Processing:', transcript);
    setIsProcessing(true);
    abortRef.current = false;
    hasStartedSpeakingRef.current = false;
    resetAudioTiming();

    // Add user message
    const userTimestamp = Date.now();
    const userMessage: Message = {
      role: 'user',
      text: transcript,
      timestamp: userTimestamp
    };
    onMessageAdded(userMessage);
    historyRef.current.push({ role: 'user', text: transcript });

    // Create placeholder for AI message (will be updated as text streams)
    // Use userTimestamp + 1 to guarantee unique timestamp (avoids collision bug)
    const aiTimestamp = userTimestamp + 1;
    currentMessageRef.current = { timestamp: aiTimestamp, text: '' };

    onMessageAdded({
      role: 'model',
      text: '...',
      timestamp: aiTimestamp
    });

    // Stream response - TTS starts as soon as first sentence is ready
    await streamChatResponse(
      transcript,
      context,
      historyRef.current.slice(0, -1),
      {
        onSentence: (sentence) => {
          if (abortRef.current) return;

          // Update message text incrementally
          if (currentMessageRef.current) {
            currentMessageRef.current.text += (currentMessageRef.current.text ? ' ' : '') + sentence;
            onMessageUpdated?.(currentMessageRef.current.timestamp, currentMessageRef.current.text);
          }

          // Queue for TTS immediately (prefetches audio)
          queueSentenceForSpeech(sentence);
        },
        onFullText: (fullText, groundingSources) => {
          // Final update with complete text
          if (currentMessageRef.current) {
            onMessageUpdated?.(currentMessageRef.current.timestamp, fullText);
          }
          historyRef.current.push({ role: 'model', text: fullText });
          currentMessageRef.current = null;
          // Note: isProcessing is turned off when first audio starts playing
        },
        onError: (error) => {
          console.error('[useChat] Stream error:', error);
          if (currentMessageRef.current) {
            onMessageUpdated?.(currentMessageRef.current.timestamp, 'Sorry, I encountered an error.');
          }
          currentMessageRef.current = null;
          setIsProcessing(false);
        }
      }
    );
  }, [context, onMessageAdded, onMessageUpdated, queueSentenceForSpeech]);

  // Start listening (push-to-talk start)
  const startListening = useCallback(() => {
    console.log('[useChat] startListening');

    // Stop any playing audio when user wants to speak
    abortRef.current = true;
    audioQueueRef.current = [];
    stopAudio();
    setIsSpeaking(false);
    isPlayingQueueRef.current = false;

    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
      if (!recognitionRef.current) return;

      recognitionRef.current.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript;
          console.log('[useChat] Transcript:', transcript);
          processUserInput(transcript);
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('[useChat] Recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        console.log('[useChat] Recognition ended');
      };
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error('[useChat] Failed to start recognition:', e);
    }
  }, [initRecognition, processUserInput]);

  // Stop listening (push-to-talk end)
  const stopListening = useCallback(() => {
    console.log('[useChat] stopListening');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }, []);

  // Send text message (from input field)
  const sendTextMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    abortRef.current = true;
    audioQueueRef.current = [];
    stopAudio();
    setIsSpeaking(false);
    isPlayingQueueRef.current = false;
    processUserInput(text);
  }, [processUserInput]);

  // Reset chat
  const resetChat = useCallback(() => {
    stopListening();
    abortRef.current = true;
    audioQueueRef.current = [];
    stopAudio();
    historyRef.current = [];
    currentMessageRef.current = null;
    setIsSpeaking(false);
    setIsProcessing(false);
    isPlayingQueueRef.current = false;
  }, [stopListening]);

  // Send initial greeting (non-streaming, simple)
  const sendGreeting = useCallback(async (greeting: string) => {
    setIsProcessing(true);
    abortRef.current = false;
    hasStartedSpeakingRef.current = false;
    resetAudioTiming();

    const aiMessage: Message = {
      role: 'model',
      text: greeting,
      timestamp: Date.now()
    };
    onMessageAdded(aiMessage);
    historyRef.current.push({ role: 'model', text: greeting });

    // TTS for greeting - isProcessing turns off when audio starts
    queueSentenceForSpeech(greeting);
  }, [onMessageAdded, queueSentenceForSpeech]);

  return {
    isListening,
    isSpeaking,
    isProcessing,
    startListening,
    stopListening,
    sendTextMessage,
    sendGreeting,
    resetChat
  };
};
