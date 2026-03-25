"use client";

import { useEffect, useRef } from "react";

import type { TranscriptMessage } from "@/lib/types";

type TranscriptProps = {
  messages: TranscriptMessage[];
};

export function Transcript({ messages }: TranscriptProps) {
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = logRef.current;
    if (!element) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <section className="transcript">
      <header>
        <h3>Transcript</h3>
      </header>
      <div className="transcript-log" ref={logRef}>
        {messages.length === 0 && <p className="empty">Conversation appears here once voice starts.</p>}
        {messages.map((message) => (
          <article key={message.id} className={`msg ${message.role}`}>
            <h4>{message.role}</h4>
            <p>{message.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
