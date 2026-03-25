"use client";

import { useState } from "react";

import { usePresentationStore } from "@/lib/store";
import { getVapiClient } from "@/lib/vapi";

type VoiceControlProps = {
  assistantId: string | null;
};

export function VoiceControl({ assistantId }: VoiceControlProps) {
  const voiceState = usePresentationStore((state) => state.voiceState);
  const setVoiceState = usePresentationStore((state) => state.setVoiceState);
  const pushTranscript = usePresentationStore((state) => state.pushTranscript);

  const [callActive, setCallActive] = useState(false);

  async function toggleVoice() {
    try {
      const vapi = await getVapiClient();

      if (callActive) {
        await vapi.stop();
        setCallActive(false);
        setVoiceState("idle");
        return;
      }

      if (!assistantId) {
        pushTranscript({
          role: "system",
          text: "VAPI assistant was not created for this session. Check your env vars.",
        });
        return;
      }

      setVoiceState("processing");

      vapi.removeAllListeners();
      vapi.on("call-start", () => {
        setCallActive(true);
        setVoiceState("listening");
      });

      vapi.on("speech-start", () => {
        setVoiceState("speaking");
      });

      vapi.on("speech-end", () => {
        setVoiceState("listening");
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
        };

        if (maybe.type !== "transcript") {
          return;
        }

        const text = maybe.transcript ?? maybe.text;
        if (!text) {
          return;
        }

        pushTranscript({
          role: maybe.role ?? "assistant",
          text,
        });
      });

      vapi.on("call-end", () => {
        setCallActive(false);
        setVoiceState("idle");
      });

      vapi.on("error", (error: unknown) => {
        pushTranscript({
          role: "system",
          text: `Voice error: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
        setVoiceState("idle");
        setCallActive(false);
      });

      await vapi.start(assistantId);
    } catch (error) {
      pushTranscript({
        role: "system",
        text: error instanceof Error ? error.message : "Failed to start voice",
      });
      setVoiceState("idle");
      setCallActive(false);
    }
  }

  return (
    <button className={`voice-control ${voiceState}`} onClick={() => void toggleVoice()}>
      <span className="dot" />
      <strong>
        {voiceState === "idle" && "Start Presentation"}
        {voiceState === "listening" && "Listening..."}
        {voiceState === "speaking" && "Tap to interrupt"}
        {voiceState === "processing" && "Thinking..."}
      </strong>
    </button>
  );
}
