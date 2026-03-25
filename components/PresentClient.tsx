"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { SlideStrip } from "@/components/SlideStrip";
import { SlideViewer } from "@/components/SlideViewer";
import { Transcript } from "@/components/Transcript";
import { VoiceControl } from "@/components/VoiceControl";
import { usePresentationStore } from "@/lib/store";
import type { SlideData } from "@/lib/types";

export function PresentClient() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const missingSessionId = !sessionId;
  const activeSessionId = sessionId ?? "";
  const assistantIdFromQuery = params.get("assistantId");

  const slides = usePresentationStore((state) => state.slides);
  const currentIndex = usePresentationStore((state) => state.currentIndex);
  const assistantId = usePresentationStore((state) => state.assistantId);
  const transcript = usePresentationStore((state) => state.transcript);
  const setSession = usePresentationStore((state) => state.setSession);
  const setCurrentIndex = usePresentationStore((state) => state.setCurrentIndex);
  const pushTranscript = usePresentationStore((state) => state.pushTranscript);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("present-scroll-lock");
    document.body.classList.add("present-scroll-lock");

    return () => {
      document.documentElement.classList.remove("present-scroll-lock");
      document.body.classList.remove("present-scroll-lock");
    };
  }, []);

  useEffect(() => {
    if (missingSessionId || !sessionId) {
      return;
    }

    let cancelled = false;

    async function loadSlides() {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/slides/${activeSessionId}`);
      const payload = (await response.json()) as {
        slides?: SlideData[];
        currentSlide?: number;
        assistantId?: string | null;
        error?: string;
      };

      if (!response.ok || !payload.slides) {
        if (!cancelled) {
          setError(payload.error ?? "Failed to load session slides");
          setLoading(false);
        }
        return;
      }

      if (cancelled) {
        return;
      }

      setSession({
        slides: payload.slides,
        currentIndex: payload.currentSlide ?? 0,
        sessionId: activeSessionId,
        assistantId: assistantIdFromQuery || payload.assistantId || null,
      });
      setLoading(false);
    }

    void loadSlides();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, assistantIdFromQuery, missingSessionId, sessionId, setSession]);

  useEffect(() => {
    if (missingSessionId || !sessionId) {
      return;
    }

    const source = new EventSource(
      `/api/slides/stream?session=${encodeURIComponent(activeSessionId)}`,
    );
    eventSourceRef.current = source;

    source.addEventListener("slide", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { slideIndex?: number };
      if (typeof data.slideIndex === "number") {
        setCurrentIndex(data.slideIndex);
      }
    });

    source.addEventListener("expired", () => {
      setError("Session expired. Upload the PDF again.");
      source.close();
    });

    source.onerror = () => {
      pushTranscript({
        role: "system",
        text: "Live slide sync disconnected. Refresh to reconnect.",
      });
      source.close();
    };

    return () => {
      source.close();
      eventSourceRef.current = null;
    };
  }, [activeSessionId, missingSessionId, pushTranscript, sessionId, setCurrentIndex]);

  const slide = useMemo(() => slides[currentIndex] ?? null, [slides, currentIndex]);

  if (missingSessionId) {
    return (
      <div className="present-loading">
        <p>Missing session id in URL.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="present-loading">
        <p>Loading session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="present-loading">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="present-page">
      <main className="present-main">
        <SlideViewer
          slide={slide}
          index={currentIndex}
          total={slides.length}
          onPrev={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          onNext={() => setCurrentIndex(Math.min(slides.length - 1, currentIndex + 1))}
        />
        <SlideStrip slides={slides} currentIndex={currentIndex} onSelect={setCurrentIndex} />
      </main>

      <aside className="present-side">
        <Transcript messages={transcript} />
        <VoiceControl assistantId={assistantId} />
      </aside>
    </div>
  );
}
