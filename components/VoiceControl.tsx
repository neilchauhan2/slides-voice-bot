"use client";

import { useEffect, useRef, useState } from "react";

import { usePresentationStore } from "@/lib/store";
import { getVapiClient } from "@/lib/vapi";
import type { SlideData } from "@/lib/types";

type VoiceControlProps = {
  assistantId: string | null;
};

const AUTO_PRESENT_MARKER = "[AUTO_PRESENT_SLIDE]";
const MAX_AUTO_NARRATION_RETRIES = 2;
const HUMAN_INPUT_WINDOW_MS = 8000;

export function VoiceControl({ assistantId }: VoiceControlProps) {
  const slides = usePresentationStore((state) => state.slides);
  const sessionId = usePresentationStore((state) => state.sessionId);
  const currentIndex = usePresentationStore((state) => state.currentIndex);
  const setCurrentIndex = usePresentationStore((state) => state.setCurrentIndex);
  const voiceState = usePresentationStore((state) => state.voiceState);
  const setVoiceState = usePresentationStore((state) => state.setVoiceState);
  const pushTranscript = usePresentationStore((state) => state.pushTranscript);
  const upsertTranscript = usePresentationStore((state) => state.upsertTranscript);

  const [callActive, setCallActive] = useState(false);
  const [presentationPaused, setPresentationPaused] = useState(false);
  const lastHandledUserTranscriptRef = useRef<string>("");
  const latestNavigationRequestRef = useRef(0);
  const explicitNavigationLockUntilRef = useRef(0);
  const assistantMutedRef = useRef(false);
  const autoPresentationActiveRef = useRef(false);
  const autoPresentationPausedRef = useRef(false);
  const awaitingAutoSlideCompletionRef = useRef<number | null>(null);
  const autoSlideAttemptRef = useRef<{ slideIndex: number; retries: number }>({
    slideIndex: -1,
    retries: 0,
  });
  const autoNarrationRequestInFlightRef = useRef(false);
  const autoNarrationStopRequestedRef = useRef(false);
  const pendingSyntheticUserFinalsRef = useRef(0);
  const lastHumanVoiceInputAtRef = useRef(0);
  const voiceStateRef = useRef(voiceState);
  const currentIndexRef = useRef(currentIndex);
  const liveTranscriptIdRef = useRef<{
    user: string | null;
    assistant: string | null;
  }>({
    user: null,
    assistant: null,
  });
  const lastFinalTranscriptRef = useRef<{
    user: { text: string; at: number } | null;
    assistant: { text: string; at: number } | null;
  }>({
    user: null,
    assistant: null,
  });
  const accumulatedAssistantTranscriptRef = useRef<string>("");
  const lastSpeechEndRef = useRef<number>(0);

  useEffect(() => {
    voiceStateRef.current = voiceState;
  }, [voiceState]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  function updateVoiceState(next: typeof voiceState) {
    voiceStateRef.current = next;
    setVoiceState(next);
  }

  const numberWordMap: Record<string, number> = {
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    fourth: 4,
    five: 5,
    fifth: 5,
    six: 6,
    sixth: 6,
    seven: 7,
    seventh: 7,
    eight: 8,
    eighth: 8,
    nine: 9,
    ninth: 9,
    ten: 10,
    tenth: 10,
    eleven: 11,
    eleventh: 11,
    twelve: 12,
    twelfth: 12,
    thirteen: 13,
    thirteenth: 13,
    fourteen: 14,
    fourteenth: 14,
    fifteen: 15,
    fifteenth: 15,
  };

  function parseSlideNumber(rawValue: string): number | null {
    const cleaned = rawValue
      .toLowerCase()
      .trim()
      .replace(/[.,!?]/g, "")
      .replace(/-/g, " ");

    const numericValue = Number(cleaned);
    if (Number.isInteger(numericValue) && numericValue > 0) {
      return numericValue;
    }

    return numberWordMap[cleaned] ?? null;
  }

  function isLikelyNavigationCommand(text: string): boolean {
    return /(go to|move to|jump to|open|show|slide|page|next|previous|go back|back)/i.test(text);
  }

  function normalizeTranscriptForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function makeLiveTranscriptId(role: "user" | "assistant") {
    return `live-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildAutoNarrationPrompt(slide: SlideData, totalSlides: number) {
    const snippet = (slide.textContent || slide.textSummary || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1200);

    return [
      AUTO_PRESENT_MARKER,
      `Present slide ${slide.index + 1} of ${totalSlides}.`,
      `Slide title: ${slide.title}`,
      snippet ? `Slide notes: ${snippet}` : "Slide notes: minimal text available.",
      "Begin immediately with a complete explanation of this slide.",
      "Speak naturally like a human presenter explaining to an audience.",
      "Give a full 2-4 sentence explanation covering the key points.",
      "Do not read slide text verbatim - paraphrase and explain.",
      "Do not ask for confirmation or wait for permission.",
      "Do not use filler phrases like 'one moment', 'hold on', or 'just a sec'.",
      "Do not call navigate_to_slide in this response.",
    ].join("\n");
  }

  function isInternalAutoPrompt(text: string): boolean {
    return text.includes(AUTO_PRESENT_MARKER);
  }

  function isLowValueAssistantResponse(text: string) {
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return true;
    }

    const words = normalized.split(" ").filter(Boolean);
    const fillerPattern =
      /(one moment|1 moment|just a sec|just a second|give me a moment|hold on|please wait|let me think|processing)/;

    // Only reject pure filler responses
    if (fillerPattern.test(normalized) && words.length <= 8) {
      return true;
    }

    // Accept responses with at least 6 words as valid narration
    if (words.length < 6) {
      return true;
    }

    return false;
  }

  function resetAutoPresentationState() {
    autoPresentationActiveRef.current = false;
    autoPresentationPausedRef.current = false;
    awaitingAutoSlideCompletionRef.current = null;
    autoSlideAttemptRef.current = { slideIndex: -1, retries: 0 };
    autoNarrationRequestInFlightRef.current = false;
    autoNarrationStopRequestedRef.current = false;
    pendingSyntheticUserFinalsRef.current = 0;
    lastHumanVoiceInputAtRef.current = 0;
    setPresentationPaused(false);
  }

  function updateLiveTranscript(
    role: "user" | "assistant",
    text: string,
    isFinal: boolean,
  ) {
    const normalized = normalizeTranscriptForDedup(text);
    if (!normalized) {
      return false;
    }

    if (isFinal) {
      const recent = lastFinalTranscriptRef.current[role];
      if (recent && recent.text === normalized && Date.now() - recent.at < 2500) {
        liveTranscriptIdRef.current[role] = null;
        return false;
      }
    }

    let transcriptId = liveTranscriptIdRef.current[role];
    if (!transcriptId) {
      transcriptId = makeLiveTranscriptId(role);
      liveTranscriptIdRef.current[role] = transcriptId;
    }

    upsertTranscript({
      id: transcriptId,
      role,
      text: text.trim(),
    });

    if (isFinal) {
      lastFinalTranscriptRef.current[role] = {
        text: normalized,
        at: Date.now(),
      };
      liveTranscriptIdRef.current[role] = null;
      return true;
    }

    return false;
  }

  function sendAssistantControl(control: "mute-assistant" | "unmute-assistant") {
    void getVapiClient()
      .then((vapi) => {
        vapi.send({
          type: "control",
          control,
        });
      })
      .catch(() => {
        // Ignore transient control failures; call state continues independently.
      });
  }

  function getExplicitSlideIndex(text: string, totalSlides: number): number | null {
    const patterns = [
      /(?:slide|page)\s*(?:number\s*)?([a-z-]+|\d{1,3})/i,
      /([a-z-]+|\d{1,3})(?:st|nd|rd|th)?\s*(?:slide|page)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) {
        continue;
      }

      const slideNumber = parseSlideNumber(match[1]);
      if (
        slideNumber !== null &&
        Number.isInteger(slideNumber) &&
        slideNumber >= 1 &&
        slideNumber <= totalSlides
      ) {
        return slideNumber - 1;
      }
    }

    return null;
  }

  function rankSlideByText(text: string, allSlides: SlideData[]): number | null {
    const normalized = text.toLowerCase();
    const tokens = normalized
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3);

    if (tokens.length === 0) {
      return null;
    }

    let bestIndex = -1;
    let bestScore = 0;

    for (const slide of allSlides) {
      const title = slide.title.toLowerCase();
      const body = slide.textContent.toLowerCase();
      let score = 0;

      for (const token of tokens) {
        if (title.includes(token)) {
          score += 3;
        }
        if (body.includes(token)) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = slide.index;
      }
    }

    return bestScore > 0 ? bestIndex : null;
  }

  async function triggerSlideNavigation(
    slideIndex: number,
    reason: string,
    requestId: number,
    kind: "explicit" | "semantic",
  ): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    const response = await fetch(`/api/vapi/tool-call?session=${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "navigate_to_slide",
        parameters: {
          slideIndex,
          reason,
        },
        metadata: {
          sessionId,
          navigationPriority: kind === "explicit" ? "explicit" : "normal",
        },
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ error: "Navigation failed" }))) as {
        error?: string;
      };

      pushTranscript({
        role: "system",
        text: `Auto navigation failed: ${payload.error ?? "Unknown error"}`,
      });
      return false;
    }

    if (requestId !== latestNavigationRequestRef.current) {
      return false;
    }

    if (
      kind === "semantic" &&
      Date.now() < explicitNavigationLockUntilRef.current
    ) {
      return false;
    }

    // Update UI immediately even if SSE delivery is delayed.
    setCurrentIndex(slideIndex);
    return true;
  }

  async function queueAutoSlideNarration(slideIndex: number) {
    if (
      autoNarrationRequestInFlightRef.current ||
      autoNarrationStopRequestedRef.current ||
      !slides[slideIndex]
    ) {
      return;
    }

    const slide = slides[slideIndex];
    autoNarrationRequestInFlightRef.current = true;

    try {
      const requestId = Date.now();
      latestNavigationRequestRef.current = requestId;
      const navigationSucceeded = await triggerSlideNavigation(
        slideIndex,
        slideIndex === 0
          ? "Auto presentation start"
          : "Auto presentation next slide",
        requestId,
        "explicit",
      );

      if (!navigationSucceeded || autoNarrationStopRequestedRef.current) {
        return;
      }

      awaitingAutoSlideCompletionRef.current = slideIndex;
      if (autoSlideAttemptRef.current.slideIndex !== slideIndex) {
        autoSlideAttemptRef.current = { slideIndex, retries: 0 };
      }
      const vapi = await getVapiClient();
      pendingSyntheticUserFinalsRef.current += 1;
      vapi.send({
        type: "add-message",
        message: {
          role: "user",
          content: buildAutoNarrationPrompt(slide, slides.length),
        },
        triggerResponseEnabled: true,
      });
    } catch (error) {
      pushTranscript({
        role: "system",
        text:
          error instanceof Error
            ? `Auto narration failed: ${error.message}`
            : "Auto narration failed",
      });
    } finally {
      autoNarrationRequestInFlightRef.current = false;
    }
  }

  async function startAutoPresentation() {
    if (!slides.length) {
      pushTranscript({
        role: "system",
        text: "No slides available for automatic presentation.",
      });
      return;
    }

    autoNarrationStopRequestedRef.current = false;
    autoPresentationActiveRef.current = true;
    autoPresentationPausedRef.current = false;
    setPresentationPaused(false);
    awaitingAutoSlideCompletionRef.current = null;
    await queueAutoSlideNarration(0);
  }

  async function resumeAutoPresentation() {
    if (!slides.length) {
      return;
    }

    autoPresentationPausedRef.current = false;
    autoNarrationStopRequestedRef.current = false;
    autoPresentationActiveRef.current = true;
    setPresentationPaused(false);

    if (assistantMutedRef.current) {
      sendAssistantControl("unmute-assistant");
      assistantMutedRef.current = false;
    }

    const fallbackResumeIndex = Math.min(
      Math.max(currentIndexRef.current, 0),
      slides.length - 1,
    );
    const pendingSlideIndex = awaitingAutoSlideCompletionRef.current;
    const resumeIndex =
      pendingSlideIndex !== null
        ? Math.min(Math.max(pendingSlideIndex, 0), slides.length - 1)
        : fallbackResumeIndex;
    awaitingAutoSlideCompletionRef.current = null;
    pushTranscript({
      role: "system",
      text: `Presentation resumed from slide ${resumeIndex + 1}.`,
    });
    await queueAutoSlideNarration(resumeIndex);
  }

  async function handleExplicitSlideNavigation(slideIndex: number) {
    // Direct client-side navigation for explicit slide requests
    // This bypasses VAPI tool calls entirely to avoid filler phrase loops
    const slide = slides[slideIndex];
    if (!slide) return;

    // Lock to prevent semantic navigation from overriding
    explicitNavigationLockUntilRef.current = Date.now() + 15000;
    
    // Clear any pending auto-presentation state
    awaitingAutoSlideCompletionRef.current = null;
    accumulatedAssistantTranscriptRef.current = "";
    
    // Navigate immediately on client
    setCurrentIndex(slideIndex);
    
    pushTranscript({
      role: "system",
      text: `Navigating to slide ${slideIndex + 1}...`,
    });

    // Send a direct presentation prompt to VAPI (with AUTO_PRESENT_SLIDE marker)
    // This tells the assistant to present without calling navigate_to_slide
    try {
      const vapi = await getVapiClient();
      pendingSyntheticUserFinalsRef.current += 1;
      vapi.send({
        type: "add-message",
        message: {
          role: "user",
          content: buildAutoNarrationPrompt(slide, slides.length),
        },
        triggerResponseEnabled: true,
      });
    } catch {
      pushTranscript({
        role: "system",
        text: "Failed to request slide presentation.",
      });
    }
  }

  async function autoNavigateFromUserTranscript(text: string) {
    if (!slides.length) {
      return;
    }

    const explicitIndex = getExplicitSlideIndex(text, slides.length);

    if (explicitIndex !== null) {
      // User asked to go to a specific slide - handle entirely client-side
      await handleExplicitSlideNavigation(explicitIndex);
      return;
    }

    // For other navigation commands like "next" or "previous", let VAPI handle
    if (isLikelyNavigationCommand(text)) {
      return;
    }

    if (Date.now() < explicitNavigationLockUntilRef.current) {
      return;
    }

    const requestId = Date.now();
    latestNavigationRequestRef.current = requestId;

    const rankedIndex = rankSlideByText(text, slides);
    if (rankedIndex !== null) {
      await triggerSlideNavigation(
        rankedIndex,
        "Topic relevance match",
        requestId,
        "semantic",
      );
    }
  }

  function maybeAutoNavigate(text: string) {
    if (isInternalAutoPrompt(text)) {
      return;
    }

    const normalized = normalizeTranscriptForDedup(text);
    if (!normalized || normalized === lastHandledUserTranscriptRef.current) {
      return;
    }

    lastHandledUserTranscriptRef.current = normalized;
    void autoNavigateFromUserTranscript(text);
  }

  async function pauseVoice() {
    try {
      if (!callActive || autoPresentationPausedRef.current) {
        return;
      }

      autoPresentationPausedRef.current = true;
      autoPresentationActiveRef.current = false;
      autoNarrationStopRequestedRef.current = true;
      awaitingAutoSlideCompletionRef.current = null;
      autoNarrationRequestInFlightRef.current = false;
      setPresentationPaused(true);

      if (!assistantMutedRef.current) {
        sendAssistantControl("mute-assistant");
        assistantMutedRef.current = true;
      }

      updateVoiceState("listening");
      pushTranscript({
        role: "system",
        text: `Presentation paused on slide ${currentIndex + 1}.`,
      });
    } catch {
      // Ignore pause errors and keep the call alive.
    }
  }

  async function startVoice() {
    try {
      const vapi = await getVapiClient();

      if (callActive) {
        if (autoPresentationPausedRef.current) {
          await resumeAutoPresentation();
        }
        return;
      }

      if (!assistantId) {
        pushTranscript({
          role: "system",
          text: "VAPI assistant was not created for this session. Check your env vars.",
        });
        return;
      }

      updateVoiceState("processing");
      assistantMutedRef.current = false;
      resetAutoPresentationState();

      vapi.removeAllListeners();
      vapi.on("call-start", () => {
        setCallActive(true);
        updateVoiceState("listening");
        void startAutoPresentation();
      });

      vapi.on("speech-start", () => {
        updateVoiceState("speaking");
      });

      vapi.on("speech-end", () => {
        if (assistantMutedRef.current && !autoPresentationPausedRef.current) {
          sendAssistantControl("unmute-assistant");
          assistantMutedRef.current = false;
        }
        updateVoiceState("listening");
        lastSpeechEndRef.current = Date.now();

        if (
          !autoPresentationActiveRef.current ||
          autoNarrationStopRequestedRef.current ||
          autoPresentationPausedRef.current
        ) {
          return;
        }

        // Handle slide advancement on speech-end using accumulated transcript
        const completedSlideIndex = awaitingAutoSlideCompletionRef.current;
        if (completedSlideIndex === null) {
          return;
        }

        const accumulatedText = accumulatedAssistantTranscriptRef.current.trim();
        accumulatedAssistantTranscriptRef.current = "";

        if (!accumulatedText || isLowValueAssistantResponse(accumulatedText)) {
          if (autoSlideAttemptRef.current.slideIndex !== completedSlideIndex) {
            autoSlideAttemptRef.current = { slideIndex: completedSlideIndex, retries: 0 };
          }

          if (autoSlideAttemptRef.current.retries < MAX_AUTO_NARRATION_RETRIES) {
            autoSlideAttemptRef.current.retries += 1;
            const slide = slides[completedSlideIndex];
            if (slide) {
              pushTranscript({
                role: "system",
                text: `Retrying slide ${completedSlideIndex + 1} narration with richer detail.`,
              });

              void getVapiClient().then((vapiClient) => {
                pendingSyntheticUserFinalsRef.current += 1;
                vapiClient.send({
                  type: "add-message",
                  message: {
                    role: "user",
                    content: [
                      buildAutoNarrationPrompt(slide, slides.length),
                      "Start directly with the explanation. No filler preface.",
                      "Include concrete points from this slide.",
                      "Do not call navigate_to_slide in this response.",
                    ].join("\n"),
                  },
                  triggerResponseEnabled: true,
                });
              });
            }

            return;
          }

          autoPresentationActiveRef.current = false;
          autoPresentationPausedRef.current = true;
          autoNarrationStopRequestedRef.current = true;
          awaitingAutoSlideCompletionRef.current = completedSlideIndex;
          setPresentationPaused(true);
          pushTranscript({
            role: "system",
            text: `Paused on slide ${completedSlideIndex + 1}: assistant response stayed too short. Press Resume to retry this slide.`,
          });
          return;
        }

        // Good response - advance to next slide
        awaitingAutoSlideCompletionRef.current = null;
        autoSlideAttemptRef.current = { slideIndex: -1, retries: 0 };
        const nextSlide = completedSlideIndex + 1;

        if (nextSlide >= slides.length) {
          autoPresentationActiveRef.current = false;
          pushTranscript({
            role: "system",
            text: "Presentation complete.",
          });
          return;
        }

        void queueAutoSlideNarration(nextSlide);
      });

      vapi.on("message", (message: unknown) => {
        if (typeof message !== "object" || message === null) {
          return;
        }

        const maybe = message as {
          type?: string;
          role?: "user" | "assistant";
          transcript?: string;
          text?: string;
          transcriptType?: string;
          isFinal?: boolean;
          messages?: Array<{
            role?: string;
            content?: string;
          }>;
          messagesOpenAIFormatted?: Array<{
            role?: string;
            content?: string;
          }>;
        };

        if (maybe.type === "conversation-update") {
          const history = maybe.messagesOpenAIFormatted ?? maybe.messages ?? [];
          const lastUserMessage = [...history]
            .reverse()
            .find((entry) => entry.role === "user" && typeof entry.content === "string");

          if (lastUserMessage?.content) {
            maybeAutoNavigate(lastUserMessage.content);
          }

          return;
        }

        if (maybe.type === "user-interrupted") {
          lastHumanVoiceInputAtRef.current = Date.now();
          pendingSyntheticUserFinalsRef.current = 0;
          updateVoiceState("listening");
          return;
        }

        if (maybe.type === "voice-input") {
          lastHumanVoiceInputAtRef.current = Date.now();
          pendingSyntheticUserFinalsRef.current = 0;

          if (voiceStateRef.current !== "speaking") {
            return;
          }

          if (!assistantMutedRef.current) {
            sendAssistantControl("mute-assistant");
            assistantMutedRef.current = true;
          }
          updateVoiceState("listening");
          return;
        }

        if (!maybe.type?.startsWith("transcript")) {
          return;
        }

        if (
          maybe.role === "user" &&
          voiceStateRef.current === "speaking" &&
          !assistantMutedRef.current
        ) {
          sendAssistantControl("mute-assistant");
          assistantMutedRef.current = true;
          updateVoiceState("listening");
        }

        const text = maybe.transcript ?? maybe.text;
        if (!text) {
          return;
        }

        const role = maybe.role === "user" ? "user" : "assistant";
        const isPartialSignal =
          maybe.transcriptType === "partial" ||
          maybe.type === "transcript-partial" ||
          maybe.isFinal === false;
        const isFinalSignal =
          maybe.transcriptType === "final" ||
          maybe.type === "transcript-final" ||
          maybe.isFinal === true;
        const shouldFinalize = isFinalSignal || !isPartialSignal;

        const shouldHandleAsFinal = updateLiveTranscript(role, text, shouldFinalize);

        if (role === "user" && shouldHandleAsFinal) {
          if (pendingSyntheticUserFinalsRef.current > 0) {
            pendingSyntheticUserFinalsRef.current -= 1;
            return;
          }

          const likelyHumanInput =
            Date.now() - lastHumanVoiceInputAtRef.current < HUMAN_INPUT_WINDOW_MS;

          if (autoPresentationActiveRef.current && !likelyHumanInput) {
            return;
          }

          if (isInternalAutoPrompt(text)) {
            return;
          }

          if (autoPresentationPausedRef.current) {
            return;
          }

          // Only clear auto-presentation state if user said something meaningful
          // (more than just noise or very short utterances)
          const normalizedText = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
          const wordCount = normalizedText.split(/\s+/).filter(Boolean).length;
          if (wordCount >= 2) {
            // User is asking a question - clear auto-presentation state for this slide
            awaitingAutoSlideCompletionRef.current = null;
            accumulatedAssistantTranscriptRef.current = "";
          }
          
          if (assistantMutedRef.current) {
            sendAssistantControl("unmute-assistant");
            assistantMutedRef.current = false;
          }
          maybeAutoNavigate(text);
          return;
        }

        if (
          role === "assistant" &&
          autoPresentationActiveRef.current &&
          !autoPresentationPausedRef.current
        ) {
          // Accumulate assistant transcript text for evaluation on speech-end
          accumulatedAssistantTranscriptRef.current = text;
        }
      });

      vapi.on("call-end", () => {
        resetAutoPresentationState();
        setCallActive(false);
        updateVoiceState("idle");
      });

      vapi.on("error", (error: unknown) => {
        resetAutoPresentationState();
        pushTranscript({
          role: "system",
          text: `Voice error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        updateVoiceState("idle");
        setCallActive(false);
      });

      await vapi.start(assistantId, {
        stopSpeakingPlan: {
          numWords: 0,
          voiceSeconds: 0.1,
          backoffSeconds: 0.35,
        },
      });
    } catch (error) {
      resetAutoPresentationState();
      pushTranscript({
        role: "system",
        text: error instanceof Error ? error.message : "Failed to start voice",
      });
      updateVoiceState("idle");
      setCallActive(false);
    }
  }

  return (
    <div className="voice-controls">
      <button
        className={`voice-control ${voiceState}`}
        onClick={() => void startVoice()}
        disabled={callActive && !presentationPaused}
      >
        <span className="dot" />
        <strong>
          {presentationPaused
            ? "Resume Presentation"
            : voiceState === "processing"
              ? "Starting..."
              : voiceState === "speaking"
                ? "Presenting..."
                : voiceState === "listening"
                  ? "Listening..."
                  : "Start Presentation"}
        </strong>
      </button>
      <button
        className="voice-stop"
        onClick={() => void pauseVoice()}
        disabled={!callActive || presentationPaused}
      >
        Pause
      </button>
    </div>
  );
}
