import { NextResponse } from "next/server";

import { getSession, updateCurrentSlide } from "@/lib/session";

type ToolCallPayload = {
  name?: string;
  toolCallId?: string;
  parameters?: {
    slideIndex?: number;
    reason?: string;
  };
  metadata?: {
    sessionId?: string;
  };
  message?: {
    toolCalls?: Array<{
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
};

function parsePayload(raw: ToolCallPayload) {
  const fallbackCall = raw.message?.toolCalls?.[0];
  const fallbackArgs = fallbackCall?.function?.arguments
    ? (JSON.parse(fallbackCall.function.arguments) as {
        slideIndex?: number;
        reason?: string;
      })
    : undefined;

  return {
    name: raw.name ?? fallbackCall?.function?.name,
    slideIndex: raw.parameters?.slideIndex ?? fallbackArgs?.slideIndex,
    reason: raw.parameters?.reason ?? fallbackArgs?.reason,
    toolCallId: raw.toolCallId,
    metadataSessionId: raw.metadata?.sessionId,
  };
}

export async function POST(request: Request) {
  try {
    const querySession = new URL(request.url).searchParams.get("session");
    const body = (await request.json()) as ToolCallPayload;
    const parsed = parsePayload(body);

    if (parsed.name !== "navigate_to_slide") {
      return NextResponse.json({ error: "Unsupported tool" }, { status: 400 });
    }

    const sessionId = parsed.metadataSessionId ?? querySession;
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing session id" },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const slideIndex = Number(parsed.slideIndex);
    if (!Number.isInteger(slideIndex)) {
      return NextResponse.json(
        { error: "slideIndex must be an integer" },
        { status: 400 },
      );
    }

    const updated = updateCurrentSlide(sessionId, slideIndex);
    if (!updated) {
      return NextResponse.json(
        {
          error: `slideIndex out of bounds. Expected 0..${session.slides.length - 1}`,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      toolCallId: parsed.toolCallId,
      result: `Navigated to slide ${slideIndex + 1}`,
      reason: parsed.reason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid tool call payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
