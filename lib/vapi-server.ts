import type { SlideData } from "@/lib/types";

const VAPI_API_BASE = "https://api.vapi.ai";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

function summarizeForPrompt(slides: SlideData[]) {
  const maxChars = slides.length >= 20 ? 50 : 150;

  return slides
    .map((slide) => {
      const summary =
        slide.textContent.slice(0, maxChars).trim() || "Minimal text available";
      return `Slide ${slide.index + 1} - \"${slide.title}\": ${summary}`;
    })
    .join("\n");
}

function buildSystemPrompt(deckTitle: string, slides: SlideData[]) {
  return [
    `You are an AI presentation assistant. You are presenting a deck titled \"${deckTitle}\".`,
    "",
    "SLIDES:",
    summarizeForPrompt(slides),
    "",
    "RULES:",
    "- When the user asks about any topic, call navigate_to_slide with the most relevant slide index.",
    "- After navigating, explain that slide's content naturally and conversationally.",
    "- Keep responses concise: 2-4 sentences per slide explanation.",
    "- If the user says next, previous, or go back, navigate accordingly.",
    "- For image-heavy slides with little text, explain what that slide likely covers in a real presentation.",
  ].join("\n");
}

export async function createAssistantForSession(input: {
  sessionId: string;
  slides: SlideData[];
  appUrl: string;
}): Promise<{ assistantId: string | null; reason?: string }> {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    return {
      assistantId: null,
      reason: "VAPI_API_KEY is not set; assistant creation skipped",
    };
  }

  const deckTitle = input.slides[0]?.title || "Untitled deck";
  const systemPrompt = buildSystemPrompt(deckTitle, input.slides);

  const response = await fetch(`${VAPI_API_BASE}/assistant`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `slides-session-${input.sessionId}`,
      firstMessage: "Ready when you are. Ask me to start presenting.",
      model: {
        provider: "groq",
        model: DEFAULT_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "navigate_to_slide",
              description:
                "Navigate to the slide most relevant to the user's question",
              parameters: {
                type: "object",
                properties: {
                  slideIndex: {
                    type: "number",
                    description: "0-based index",
                  },
                  reason: {
                    type: "string",
                    description: "Brief reason why this slide is relevant",
                  },
                },
                required: ["slideIndex"],
              },
            },
            server: {
              url: `${input.appUrl}/api/vapi/tool-call?session=${encodeURIComponent(input.sessionId)}`,
            },
          },
        ],
      },
      metadata: {
        sessionId: input.sessionId,
      },
      serverMessages: ["tool-calls"],
      clientMessages: ["transcript", "speech-update"],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `VAPI assistant creation failed: ${response.status} ${body}`,
    );
  }

  const payload = (await response.json()) as { id?: string };
  return { assistantId: payload.id ?? null };
}
