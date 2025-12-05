import { useState, useRef, useCallback } from 'react';
import { generateChatResponse, generateSpeech } from '../services/gemini';
import { playAudioChunk, stopAudio, resetAudioTiming, waitForAudioEnd } from '../services/audio';
import { Message } from '../types';

interface UseChatProps {
  onMessageAdded: (message: Message) => void;
  context: string;
}

export const useChat = ({ onMessageAdded, context }: UseChatProps) => {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const recognitionRef = useRef<any>(null);
  const historyRef = useRef<{ role: string; text: string }[]>([]);

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

  // Process user speech and get AI response
  const processUserInput = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;

    console.log('[useChat] Processing:', transcript);
    setIsProcessing(true);

    // Add user message
    const userMessage: Message = {
      role: 'user',
      text: transcript,
      timestamp: Date.now()
    };
    onMessageAdded(userMessage);
    historyRef.current.push({ role: 'user', text: transcript });

    try {
      // Get AI response
      const response = await generateChatResponse(transcript, context, historyRef.current.slice(0, -1));
      console.log('[useChat] Response:', response.text);

      // Add AI message
      const aiMessage: Message = {
        role: 'model',
        text: response.text,
        timestamp: Date.now(),
        groundingSources: response.groundingSources
      };
      onMessageAdded(aiMessage);
      historyRef.current.push({ role: 'model', text: response.text });

      // Generate and play speech
      setIsSpeaking(true);
      const audioBase64 = await generateSpeech(response.text);
      if (audioBase64) {
        resetAudioTiming();
        playAudioChunk(audioBase64);
        await waitForAudioEnd();
      }
      setIsSpeaking(false);

    } catch (error) {
      console.error('[useChat] Error:', error);
      onMessageAdded({
        role: 'model',
        text: 'Sorry, I encountered an error. Please try again.',
        timestamp: Date.now()
      });
    } finally {
      setIsProcessing(false);
    }
  }, [context, onMessageAdded]);

  // Start listening (push-to-talk start)
  const startListening = useCallback(() => {
    console.log('[useChat] startListening');

    // Stop any playing audio when user wants to speak
    stopAudio();
    setIsSpeaking(false);

    if (!recognitionRef.current) {
      recognitionRef.current = initRecognition();
      if (!recognitionRef.current) return;

      recognitionRef.current.onresult = (event: any) => {
        // Get the latest result
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
        // Don't set isListening false here - we control it manually
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
    stopAudio();
    setIsSpeaking(false);
    processUserInput(text);
  }, [processUserInput]);

  // Reset chat
  const resetChat = useCallback(() => {
    stopListening();
    stopAudio();
    historyRef.current = [];
    setIsSpeaking(false);
    setIsProcessing(false);
  }, [stopListening]);

  // Send initial greeting
  const sendGreeting = useCallback(async (greeting: string) => {
    setIsProcessing(true);
    try {
      // Add greeting as AI message
      const aiMessage: Message = {
        role: 'model',
        text: greeting,
        timestamp: Date.now()
      };
      onMessageAdded(aiMessage);
      historyRef.current.push({ role: 'model', text: greeting });

      // Speak the greeting
      setIsSpeaking(true);
      const audioBase64 = await generateSpeech(greeting);
      if (audioBase64) {
        resetAudioTiming();
        playAudioChunk(audioBase64);
        await waitForAudioEnd();
      }
      setIsSpeaking(false);
    } catch (error) {
      console.error('[useChat] Greeting error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [onMessageAdded]);

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
