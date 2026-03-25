import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";

import type { SessionData } from "@/lib/types";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const sessions = new Map<string, SessionData>();

const slideEvents = new EventEmitter();
slideEvents.setMaxListeners(0);

let cleanupScheduled = false;

function scheduleCleanup() {
  if (cleanupScheduled) {
    return;
  }

  cleanupScheduled = true;
  setInterval(
    () => {
      const now = Date.now();
      for (const [sessionId, session] of sessions.entries()) {
        if (session.expiresAt > now) {
          continue;
        }

        sessions.delete(sessionId);
        slideEvents.emit(`expired:${sessionId}`);
        void deleteSessionAssets(sessionId);
      }
    },
    5 * 60 * 1000,
  ).unref();
}

async function deleteSessionAssets(sessionId: string) {
  await Promise.allSettled([
    fs.rm(path.join(process.cwd(), "tmp", "sessions", sessionId), {
      recursive: true,
      force: true,
    }),
    fs.rm(path.join(process.cwd(), "public", "sessions", sessionId), {
      recursive: true,
      force: true,
    }),
  ]);
}

scheduleCleanup();

export function setSession(
  sessionId: string,
  data: Omit<SessionData, "expiresAt">,
) {
  sessions.set(sessionId, {
    ...data,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export function getSession(sessionId: string): SessionData | undefined {
  const session = sessions.get(sessionId);
  if (!session) {
    return undefined;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    void deleteSessionAssets(sessionId);
    return undefined;
  }

  return session;
}

export function setAssistantId(sessionId: string, assistantId: string) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  session.assistantId = assistantId;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
}

export function updateCurrentSlide(
  sessionId: string,
  slideIndex: number,
): boolean {
  const session = getSession(sessionId);
  if (!session) {
    return false;
  }

  if (slideIndex < 0 || slideIndex >= session.slides.length) {
    return false;
  }

  session.currentSlide = slideIndex;
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  slideEvents.emit(`slideChanged:${sessionId}`, { slideIndex });
  return true;
}

export function subscribeToSlides(
  sessionId: string,
  onSlide: (payload: { slideIndex: number }) => void,
  onExpired: () => void,
) {
  const slideEvent = `slideChanged:${sessionId}`;
  const expireEvent = `expired:${sessionId}`;

  slideEvents.on(slideEvent, onSlide);
  slideEvents.on(expireEvent, onExpired);

  return () => {
    slideEvents.off(slideEvent, onSlide);
    slideEvents.off(expireEvent, onExpired);
  };
}
