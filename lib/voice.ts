"use client";

import * as React from "react";

type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const byName = (name: string) => voices.find((v) => v.name === name);
  const preferred =
    byName("Samantha") ??
    byName("Google UK English Female") ??
    byName("Google US English") ??
    voices.find((v) => v.lang?.startsWith("en-US") && /female/i.test(v.name)) ??
    voices.find((v) => v.lang?.startsWith("en-US")) ??
    voices.find((v) => v.lang?.startsWith("en")) ??
    voices[0];
  return preferred ?? null;
}

export function useTTS() {
  const [speaking, setSpeaking] = React.useState(false);
  const [supported, setSupported] = React.useState(false);
  const voiceRef = React.useRef<SpeechSynthesisVoice | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability sync
    setSupported(true);

    const updateVoice = () => {
      voiceRef.current = pickVoice(window.speechSynthesis.getVoices());
    };

    updateVoice();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoice);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoice);
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = React.useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const cancel = React.useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speak, cancel, speaking, supported };
}

export function useSTT() {
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [interim, setInterim] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [supported, setSupported] = React.useState(false);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const finalRef = React.useRef("");

  React.useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser capability sync
    setSupported(true);

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (event: unknown) => {
      const ev = event as {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      };
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalRef.current = `${finalRef.current} ${text}`.trim();
        } else {
          interimText += text;
        }
      }
      setTranscript(finalRef.current);
      setInterim(interimText);
    };
    rec.onerror = (event: unknown) => {
      const ev = event as { error?: string };
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      setError(ev.error ?? "Speech recognition error");
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  const start = React.useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      finalRef.current = "";
      setTranscript("");
      setInterim("");
      setError(null);
      rec.start();
      setListening(true);
    } catch (err) {
      console.warn("start recognition failed", err);
    }
  }, []);

  const stop = React.useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* noop */
    }
    setListening(false);
  }, []);

  const reset = React.useCallback(() => {
    finalRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  return { start, stop, reset, transcript, interim, listening, error, supported };
}
