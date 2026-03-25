import type { SlideData } from "@/lib/types";

const VAPI_API_BASE = "https://api.vapi.ai";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

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
    "- For direct user requests about slides, call navigate_to_slide before giving a slide-specific answer.",
    "- Exception: if a message contains '[AUTO_PRESENT_SLIDE]', do NOT call navigate_to_slide; just present that exact slide with a complete explanation.",
    "- When presenting a slide, always give a complete 2-4 sentence explanation covering key points.",
    "- Present like a confident human presenter, not like a screen reader.",
    "- NEVER read slide text verbatim; paraphrase and explain in your own words.",
    "- Start presenting immediately; do not say filler like 'one moment', 'hold on', or 'just a sec'.",
    "- Do not ask for permission to continue when in presentation flow.",
    "- If user explicitly says a slide number (e.g. 'go to slide 3'), navigate to that exact slide (user numbering starts at 1).",
    "- If user asks a question without slide number, pick the most relevant slide by topic and navigate first.",
    "- After navigating, explain that slide's content naturally and conversationally.",
    "- If the user says next, previous, or go back, navigate accordingly.",
    "- For next/previous, move relative to current slide index.",
    "- For image-heavy slides with little text, explain what that slide likely covers in a real presentation.",
    "",
    "EXAMPLES:",
    "- User: 'Go to slide 3' -> call navigate_to_slide with slideIndex: 2, then present slide 3.",
    "- User: 'What are the main risks?' -> call navigate_to_slide with the most relevant slide, then answer.",
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
      stopSpeakingPlan: {
        numWords: 0,
        voiceSeconds: 0.1,
        backoffSeconds: 0.35,
      },
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
      clientMessages: [
        "conversation-update",
        "transcript",
        "speech-update",
        "voice-input",
        "user-interrupted",
        "tool-calls",
      ],
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
