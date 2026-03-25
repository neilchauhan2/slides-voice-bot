import type { SlideData } from "@/lib/types";

const VAPI_API_BASE = "https://api.vapi.ai";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Common words to exclude from keyword extraction
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "been",
  "be",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "it",
  "we",
  "they",
  "what",
  "which",
  "who",
  "whom",
  "how",
  "when",
  "where",
  "why",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "then",
  "once",
  "if",
  "because",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "our",
  "your",
  "their",
]);

function extractKeywordsFromSlides(slides: SlideData[]): string[] {
  const wordFrequency = new Map<string, number>();

  for (const slide of slides) {
    const text = `${slide.title} ${slide.textContent}`.toLowerCase();
    // Extract words that are 4+ characters
    const words = text.match(/[a-z]{4,}/g) || [];

    for (const word of words) {
      if (!STOP_WORDS.has(word)) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
  }

  // Sort by frequency and take top keywords
  const sorted = [...wordFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word]) => word);

  // Add common navigation keywords
  return ["slide", "presentation", "next", "previous", "back", ...sorted];
}

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
    "CRITICAL RULES - NEVER BREAK THESE:",
    "- NEVER say filler phrases. Phrases like 'one moment', 'hold on', 'just a sec', 'let me', 'give me a moment', 'this will take a sec' are COMPLETELY FORBIDDEN.",
    "- Start EVERY response with actual content. No acknowledgments, no delays, no announcements.",
    "- If you cannot provide useful content, stay silent. Silence is better than filler.",
    "",
    "NAVIGATION HANDLING:",
    "- When a message contains '[AUTO_PRESENT_SLIDE]', the slide navigation is ALREADY DONE. Just present that slide directly with a complete 2-4 sentence explanation. Do NOT call navigate_to_slide.",
    "- When user says a specific slide number (like 'slide 5', 'go to slide 3'), the client handles navigation automatically. If you receive such input without [AUTO_PRESENT_SLIDE], wait for the follow-up prompt.",
    "- For next/previous/back commands, use navigate_to_slide tool, then immediately present.",
    "- For topic-based questions, use navigate_to_slide to find the relevant slide, then answer.",
    "",
    "PRESENTATION STYLE:",
    "- Give complete 2-4 sentence explanations covering key points.",
    "- Present like a confident human presenter, not a screen reader.",
    "- NEVER read slide text verbatim - paraphrase and explain.",
    "- Do not ask for permission to continue.",
    "- For image-heavy slides, explain what the slide likely covers.",
    "",
    "EXAMPLES:",
    "- [AUTO_PRESENT_SLIDE] prompt -> Immediately start: 'This slide covers...' (no navigation call needed)",
    "- User: 'next slide' -> navigate_to_slide(current+1), then 'Moving on, this slide discusses...'",
    "- User: 'What are the main risks?' -> navigate_to_slide to relevant slide, then answer directly.",
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
  const keywords = extractKeywordsFromSlides(input.slides);

  const response = await fetch(`${VAPI_API_BASE}/assistant`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `slides-session-${input.sessionId}`.slice(0, 40),
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
        smartFormat: true,
        keywords: keywords,
      },
      stopSpeakingPlan: {
        numWords: 0,
        voiceSeconds: 0.1,
        backoffSeconds: 0.35,
      },
      model: {
        provider: "groq",
        model: DEFAULT_MODEL,
        maxTokens: 500,
        temperature: 0.7,
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
