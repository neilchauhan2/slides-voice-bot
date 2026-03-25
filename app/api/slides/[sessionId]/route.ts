import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  const session = getSession(sessionId);

  if (!session) {
    return NextResponse.json(
      { error: "Session not found or expired" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    sessionId,
    slides: session.slides,
    currentSlide: session.currentSlide,
    assistantId: session.assistantId ?? null,
    expiresAt: session.expiresAt,
  });
}
