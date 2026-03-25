import { create } from "zustand";

import type { SlideData, TranscriptMessage } from "@/lib/types";

export type VoiceState = "idle" | "listening" | "speaking" | "processing";

type PresentationState = {
  slides: SlideData[];
  currentIndex: number;
  sessionId: string | null;
  assistantId: string | null;
  voiceState: VoiceState;
  transcript: TranscriptMessage[];
  setSession: (payload: {
    slides: SlideData[];
    sessionId: string;
    assistantId: string | null;
    currentIndex?: number;
  }) => void;
  setCurrentIndex: (index: number) => void;
  setVoiceState: (state: VoiceState) => void;
  pushTranscript: (
    message: Omit<TranscriptMessage, "id" | "createdAt">,
  ) => void;
  upsertTranscript: (
    message: Omit<TranscriptMessage, "createdAt"> & { createdAt?: number },
  ) => void;
  clearTranscript: () => void;
};

export const usePresentationStore = create<PresentationState>((set) => ({
  slides: [],
  currentIndex: 0,
  sessionId: null,
  assistantId: null,
  voiceState: "idle",
  transcript: [],
  setSession: ({ slides, sessionId, assistantId, currentIndex = 0 }) =>
    set({ slides, sessionId, assistantId, currentIndex }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  setVoiceState: (voiceState) => set({ voiceState }),
  pushTranscript: (message) =>
    set((state) => ({
      transcript: [
        ...state.transcript,
        {
          id: `${message.role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: Date.now(),
          ...message,
        },
      ],
    })),
  upsertTranscript: (message) =>
    set((state) => {
      const existingIndex = state.transcript.findIndex(
        (entry) => entry.id === message.id,
      );

      if (existingIndex === -1) {
        return {
          transcript: [
            ...state.transcript,
            {
              ...message,
              createdAt: message.createdAt ?? Date.now(),
            },
          ],
        };
      }

      const nextTranscript = [...state.transcript];
      const existing = nextTranscript[existingIndex];
      nextTranscript[existingIndex] = {
        ...existing,
        role: message.role,
        text: message.text,
      };

      return { transcript: nextTranscript };
    }),
  clearTranscript: () => set({ transcript: [] }),
}));
