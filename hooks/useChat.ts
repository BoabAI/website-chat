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

  // Track if we're waiting for final result after stop
  const pendingStopRef = useRef(false);
  // Track if audio has actually started (mic is capturing)
  const audioStartedRef = useRef(false);
  // Keep mic stream alive during recognition
  const micStreamRef = useRef<MediaStream | null>(null);

  // Start listening (push-to-talk start)
  const startListening = useCallback(async () => {
    console.log('[useChat] ========== START LISTENING ==========');
    console.log('[useChat] Browser:', navigator.userAgent);
    console.log('[useChat] webkitSpeechRecognition available:', 'webkitSpeechRecognition' in window);
    console.log('[useChat] SpeechRecognition available:', 'SpeechRecognition' in window);
    console.log('[useChat] mediaDevices available:', !!navigator.mediaDevices);

    // Stop any playing audio when user wants to speak
    console.log('[useChat] Stopping any playing audio...');
    abortRef.current = true;
    audioQueueRef.current = [];
    stopAudio();
    setIsSpeaking(false);
    isPlayingQueueRef.current = false;
    pendingStopRef.current = false;
    audioStartedRef.current = false;

    // Check mic permission status first
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      console.log('[useChat] 🔐 Mic permission status:', permissionStatus.state);
    } catch (e) {
      console.log('[useChat] Could not query permission status:', e);
    }

    // Get mic stream and KEEP IT ALIVE during recognition
    try {
      console.log('[useChat] 🎙️ Requesting mic via getUserMedia...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      console.log('[useChat] ✅ Mic stream obtained!');
      console.log('[useChat] Audio tracks:', tracks.length);
      tracks.forEach((track, i) => {
        console.log(`[useChat] Track ${i}: label="${track.label}", enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
      });
      // KEEP the stream alive - don't stop it!
      micStreamRef.current = stream;
      console.log('[useChat] 🔒 Mic stream kept alive for recognition');
    } catch (err: any) {
      console.error('[useChat] ❌ Mic permission denied!');
      console.error('[useChat] Error name:', err.name);
      console.error('[useChat] Error message:', err.message);
      console.error('[useChat] Full error:', err);
      return;
    }

    console.log('[useChat] Setting up SpeechRecognition...');
    if (!recognitionRef.current) {
      console.log('[useChat] Creating new recognition instance...');
      recognitionRef.current = initRecognition();
      if (!recognitionRef.current) {
        console.error('[useChat] ❌ Failed to create recognition instance!');
        return;
      }
      console.log('[useChat] Recognition instance created:', recognitionRef.current);

      recognitionRef.current.onresult = (event: any) => {
        console.log('[useChat] onresult fired, results count:', event.results.length);

        // Log all results for debugging
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          console.log(`[useChat] Result[${i}]: isFinal=${result.isFinal}, transcript="${result[0].transcript}", confidence=${result[0].confidence}`);
        }

        const lastResult = event.results[event.results.length - 1];
        if (lastResult.isFinal) {
          const transcript = lastResult[0].transcript;
          console.log('[useChat] ✅ Final transcript:', transcript);

          // If we were waiting for final result after stop, now we can process
          if (pendingStopRef.current) {
            pendingStopRef.current = false;
            setIsListening(false);
          }

          processUserInput(transcript);
        } else {
          console.log('[useChat] ⏳ Interim result (not final yet)');
        }
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('[useChat] ❌ Recognition error:', event.error, event);
        pendingStopRef.current = false;
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        console.log('[useChat] 🔚 Recognition ended, pendingStop:', pendingStopRef.current);
        // If we never got a final result, clear listening state
        if (pendingStopRef.current) {
          console.log('[useChat] ⚠️ No final result received before end');
          pendingStopRef.current = false;
          setIsListening(false);
        }
      };

      recognitionRef.current.onstart = () => {
        console.log('[useChat] 🎤 Recognition started');
      };

      recognitionRef.current.onspeechstart = () => {
        console.log('[useChat] 🗣️ Speech detected');
      };

      recognitionRef.current.onspeechend = () => {
        console.log('[useChat] 🤫 Speech ended');
      };

      recognitionRef.current.onaudiostart = () => {
        console.log('[useChat] 🔊 Audio capture started');
        audioStartedRef.current = true;
      };

      recognitionRef.current.onaudioend = () => {
        console.log('[useChat] 🔇 Audio capture ended');
      };

      recognitionRef.current.onnomatch = () => {
        console.log('[useChat] ❓ No speech match');
      };
    }

    try {
      console.log('[useChat] 🚀 Calling recognition.start()...');
      console.log('[useChat] Recognition state before start:', {
        continuous: recognitionRef.current.continuous,
        interimResults: recognitionRef.current.interimResults,
        lang: recognitionRef.current.lang,
      });
      recognitionRef.current.start();
      console.log('[useChat] ✅ recognition.start() called successfully');
      setIsListening(true);
    } catch (e: any) {
      console.error('[useChat] ❌ Failed to start recognition!');
      console.error('[useChat] Error name:', e.name);
      console.error('[useChat] Error message:', e.message);
      console.error('[useChat] Full error:', e);
    }
  }, [initRecognition, processUserInput]);

  // Helper to release mic stream
  const releaseMicStream = useCallback(() => {
    if (micStreamRef.current) {
      console.log('[useChat] 🔓 Releasing mic stream...');
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
  }, []);

  // Stop listening (push-to-talk end)
  const stopListening = useCallback(() => {
    console.log('[useChat] stopListening, audioStarted:', audioStartedRef.current);

    if (recognitionRef.current) {
      // If audio never started, we need to wait a bit for the mic to initialize
      if (!audioStartedRef.current) {
        console.log('[useChat] ⏳ Audio not started yet, waiting 500ms before stop...');
        setTimeout(() => {
          console.log('[useChat] ⏳ Delayed stop, audioStarted now:', audioStartedRef.current);
          if (recognitionRef.current) {
            pendingStopRef.current = true;
            recognitionRef.current.stop();
          }
          releaseMicStream();
        }, 500);
      } else {
        // Audio was capturing, safe to stop
        pendingStopRef.current = true;
        recognitionRef.current.stop();
        releaseMicStream();
      }
    }
    // Don't set isListening false yet - wait for final result or onend
  }, [releaseMicStream]);

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
    releaseMicStream();
    abortRef.current = true;
    audioQueueRef.current = [];
    stopAudio();
    historyRef.current = [];
    currentMessageRef.current = null;
    setIsSpeaking(false);
    setIsProcessing(false);
    isPlayingQueueRef.current = false;
  }, [stopListening, releaseMicStream]);

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
