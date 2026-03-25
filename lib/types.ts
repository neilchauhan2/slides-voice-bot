export type SlideData = {
  index: number;
  title: string;
  textContent: string;
  textSummary: string;
};

export type SessionData = {
  sessionId: string;
  slides: SlideData[];
  currentSlide: number;
  createdAt: number;
  expiresAt: number;
  assistantId?: string;
  sourcePdfPath?: string;
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: number;
};
