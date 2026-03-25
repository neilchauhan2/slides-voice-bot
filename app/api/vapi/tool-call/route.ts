import { NextResponse } from "next/server";

import { getSession, updateCurrentSlide } from "@/lib/session";

export const runtime = "nodejs";

const explicitNavigationLockBySession = new Map<
  string,
  { slideIndex: number; expiresAt: number }
>();

type ToolCallPayload = {
  name?: string;
  toolCallId?: string;
  parameters?: {
    slideIndex?: number;
    reason?: string;
  };
  metadata?: {
    sessionId?: string;
    navigationPriority?: "explicit" | "normal";
  };
  toolCallList?: Array<{
    id?: string;
    function?: {
      name?: string;
      arguments?: string | { slideIndex?: number | string; reason?: string };
    };
  }>;
  message?: {
    type?: string;
    metadata?: {
      sessionId?: string;
      navigationPriority?: "explicit" | "normal";
    };
    toolCallList?: Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: string | { slideIndex?: number | string; reason?: string };
      };
    }>;
    toolCalls?: Array<{
      id?: string;
      function?: {
        name?: string;
        arguments?: string | { slideIndex?: number | string; reason?: string };
      };
    }>;
  };
};

type ParsedToolCall = {
  name: string;
  toolCallId: string;
  slideIndex?: number;
  reason?: string;
  navigationPriority?: "explicit" | "normal";
};

function parseArgs(
  rawArgs?: string | { slideIndex?: number | string; reason?: string },
) {
  if (!rawArgs) {
    return {} as { slideIndex?: number; reason?: string };
  }

  if (typeof rawArgs === "object") {
    return {
      slideIndex:
        rawArgs.slideIndex !== undefined
          ? Number(rawArgs.slideIndex)
          : undefined,
      reason: rawArgs.reason,
    } as { slideIndex?: number; reason?: string };
  }

  try {
    const parsed = JSON.parse(rawArgs) as {
      slideIndex?: number | string;
      reason?: string;
    };

    return {
      slideIndex:
        parsed.slideIndex !== undefined ? Number(parsed.slideIndex) : undefined,
      reason: parsed.reason,
    } as { slideIndex?: number; reason?: string };
  } catch {
    return {} as { slideIndex?: number; reason?: string };
  }
}

function parsePayload(raw: ToolCallPayload) {
  const toolCallCandidates = [
    ...(raw.toolCallList ?? []),
    ...(raw.message?.toolCallList ?? []),
    ...(raw.message?.toolCalls ?? []),
  ];

  const parsedList: ParsedToolCall[] = toolCallCandidates
    .map((item) => {
      const args = parseArgs(item.function?.arguments);
      return {
        name: item.function?.name ?? "",
        toolCallId: item.id ?? raw.toolCallId ?? "",
        slideIndex: args.slideIndex,
        reason: args.reason,
        navigationPriority:
          raw.metadata?.navigationPriority ??
          raw.message?.metadata?.navigationPriority ??
          "normal",
      };
    })
    .filter((entry) => entry.name.length > 0);

  if (parsedList.length > 0) {
    return {
      calls: parsedList,
      metadataSessionId:
        raw.metadata?.sessionId ?? raw.message?.metadata?.sessionId,
    };
  }

  return {
    calls: raw.name
      ? [
          {
            name: raw.name,
            toolCallId: raw.toolCallId ?? "",
            slideIndex: raw.parameters?.slideIndex,
            reason: raw.parameters?.reason,
            navigationPriority:
              raw.metadata?.navigationPriority ??
              raw.message?.metadata?.navigationPriority ??
              "normal",
          },
        ]
      : [],
    metadataSessionId:
      raw.metadata?.sessionId ?? raw.message?.metadata?.sessionId,
  };
}

export async function POST(request: Request) {
  try {
    const querySession = new URL(request.url).searchParams.get("session");
    const body = (await request.json()) as ToolCallPayload;
    const parsed = parsePayload(body);

    if (parsed.calls.length === 0) {
      return NextResponse.json(
        { error: "No tool calls found" },
        { status: 400 },
      );
    }

    if (parsed.calls.some((call) => call.name !== "navigate_to_slide")) {
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

    const results: Array<{
      name: string;
      toolCallId: string;
      result?: string;
      error?: string;
    }> = [];

    for (const call of parsed.calls) {
      const slideIndex = Number(call.slideIndex);
      if (!Number.isInteger(slideIndex)) {
        results.push({
          name: call.name,
          toolCallId: call.toolCallId,
          error: "slideIndex must be an integer",
        });
        continue;
      }

      const existingExplicitLock =
        explicitNavigationLockBySession.get(sessionId);
      if (
        existingExplicitLock &&
        existingExplicitLock.expiresAt <= Date.now()
      ) {
        explicitNavigationLockBySession.delete(sessionId);
      }

      const currentExplicitLock =
        explicitNavigationLockBySession.get(sessionId);
      if (
        currentExplicitLock &&
        call.navigationPriority !== "explicit" &&
        slideIndex !== currentExplicitLock.slideIndex
      ) {
        results.push({
          name: call.name,
          toolCallId: call.toolCallId,
          result: `Ignored due to recent explicit command lock on slide ${currentExplicitLock.slideIndex + 1}`,
        });
        continue;
      }

      const updated = updateCurrentSlide(sessionId, slideIndex);
      if (!updated) {
        results.push({
          name: call.name,
          toolCallId: call.toolCallId,
          error: `slideIndex out of bounds. Expected 0..${session.slides.length - 1}`,
        });
        continue;
      }

      if (call.navigationPriority === "explicit") {
        explicitNavigationLockBySession.set(sessionId, {
          slideIndex,
          expiresAt: Date.now() + 12000,
        });
      }

      results.push({
        name: call.name,
        toolCallId: call.toolCallId,
        result: `Navigated to slide ${slideIndex + 1}${call.reason ? ` (${call.reason})` : ""}`,
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid tool call payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
