import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import type { SessionData } from "@/lib/types";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const SESSION_FILE_NAME = "session.json";
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

function getSessionDirectory(sessionId: string) {
  return path.join(process.cwd(), "tmp", "sessions", sessionId);
}

function getSessionFilePath(sessionId: string) {
  return path.join(getSessionDirectory(sessionId), SESSION_FILE_NAME);
}

function persistSessionToDisk(session: SessionData) {
  const sessionDir = getSessionDirectory(session.sessionId);
  const sessionFile = getSessionFilePath(session.sessionId);

  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(session), "utf8");
}

function persistSessionToDiskSafely(session: SessionData) {
  try {
    persistSessionToDisk(session);
  } catch (error) {
    console.error("Session persistence skipped:", error);
  }
}

function hydrateSessionFromDisk(sessionId: string): SessionData | undefined {
  const sessionFile = getSessionFilePath(sessionId);
  if (!existsSync(sessionFile)) {
    return undefined;
  }

  try {
    const raw = readFileSync(sessionFile, "utf8");
    const parsed = JSON.parse(raw) as SessionData;

    if (!parsed?.sessionId || !Array.isArray(parsed.slides)) {
      return undefined;
    }

    sessions.set(sessionId, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

scheduleCleanup();

export function setSession(
  sessionId: string,
  data: Omit<SessionData, "expiresAt">,
) {
  const session = {
    ...data,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  sessions.set(sessionId, session);
  persistSessionToDiskSafely(session);
}

export function getSession(sessionId: string): SessionData | undefined {
  const session = sessions.get(sessionId) ?? hydrateSessionFromDisk(sessionId);
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
  persistSessionToDiskSafely(session);
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
