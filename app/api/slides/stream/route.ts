import { getSession, subscribeToSlides } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session");

  if (!sessionId) {
    return new Response("Missing session query param", { status: 400 });
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response("Session not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const write = (event: string, payload: unknown) => {
        controller.enqueue(
          encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
          ),
        );
      };

      write("ready", {
        slideIndex: session.currentSlide,
      });

      const unsubscribe = subscribeToSlides(
        sessionId,
        ({ slideIndex }) => {
          write("slide", { slideIndex });
        },
        () => {
          write("expired", { message: "Session expired" });
          controller.close();
        },
      );

      const heartbeat = setInterval(() => {
        write("ping", { timestamp: Date.now() });
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
