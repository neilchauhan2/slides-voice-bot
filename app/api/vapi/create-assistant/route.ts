import { NextResponse } from "next/server";

import { getSession, setAssistantId } from "@/lib/session";
import { createAssistantForSession } from "@/lib/vapi-server";
import type { SlideData } from "@/lib/types";

export const runtime = "nodejs";

function appUrlFromRequest(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    `${new URL(request.url).protocol}//${new URL(request.url).host}`
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      sessionId?: string;
      slides?: SlideData[];
    };

    if (!body.sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const session = getSession(body.sessionId);
    const slides = body.slides ?? session?.slides;

    if (!slides || slides.length === 0) {
      return NextResponse.json(
        { error: "No slides found for session" },
        { status: 400 },
      );
    }

    const result = await createAssistantForSession({
      sessionId: body.sessionId,
      slides,
      appUrl: appUrlFromRequest(request),
    });

    if (result.assistantId) {
      setAssistantId(body.sessionId, result.assistantId);
    }

    return NextResponse.json({
      sessionId: body.sessionId,
      vapiAssistantId: result.assistantId,
      assistantNote: result.reason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create assistant";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
