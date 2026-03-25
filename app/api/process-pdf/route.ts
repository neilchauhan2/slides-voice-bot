import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

import { getSession, setAssistantId, setSession } from "@/lib/session";
import type { SlideData } from "@/lib/types";
import { createAssistantForSession } from "@/lib/vapi-server";

export const runtime = "nodejs";

// In Next.js server chunks, pdfjs' default relative worker path can resolve
// incorrectly (e.g. inside .next/dev/server/chunks). Point to node_modules.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "legacy",
    "build",
    "pdf.worker.mjs",
  ),
).toString();

type TextItem = {
  str?: string;
  hasEOL?: boolean;
};

function extractLines(items: TextItem[]) {
  const lines: string[] = [];
  let current = "";

  for (const item of items) {
    const token = (item.str ?? "").trim();
    if (token) {
      current = current ? `${current} ${token}` : token;
    }

    if (item.hasEOL) {
      if (current.trim()) {
        lines.push(current.trim());
      }
      current = "";
    }
  }

  if (current.trim()) {
    lines.push(current.trim());
  }

  return lines;
}

function appUrlFromRequest(request: Request) {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    `${new URL(request.url).protocol}//${new URL(request.url).host}`
  );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    const defaultPdf = formData.get("defaultPdf") as string | null;

    let sessionId = nanoid(10);
    let pdfBuffer: Buffer;
    let fileName: string = "";

    if (defaultPdf) {
      if (defaultPdf === "ml" || defaultPdf === "product_management") {
        sessionId = `default_${defaultPdf}`;
        fileName = `${defaultPdf}.pdf`;

        // Check if session and assistant already exist and haven't expired
        const existingSession = getSession(sessionId);
        if (existingSession && existingSession.assistantId) {
          return NextResponse.json({
            sessionId,
            slideCount: existingSession.slides.length,
            vapiAssistantId: existingSession.assistantId,
            assistantNote: "Loaded from cache",
          });
        }

        pdfBuffer = await fs.readFile(
          path.join(process.cwd(), "ppts", `${defaultPdf}.pdf`),
        );
      } else {
        return NextResponse.json(
          { error: "Invalid default PDF" },
          { status: 400 },
        );
      }
    } else {
      if (!(uploaded instanceof File)) {
        return NextResponse.json(
          { error: "Upload a PDF file" },
          { status: 400 },
        );
      }

      fileName = uploaded.name.toLowerCase();
      const isPdf =
        uploaded.type === "application/pdf" || fileName.endsWith(".pdf");
      if (!isPdf) {
        return NextResponse.json(
          { error: "Only .pdf files are supported" },
          { status: 400 },
        );
      }

      pdfBuffer = Buffer.from(await uploaded.arrayBuffer());
    }

    const baseDir = path.join(process.cwd(), "tmp", "sessions", sessionId);
    const inputPath = path.join(baseDir, "input.pdf");

    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(inputPath, pdfBuffer);

    const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) });
    const pdf = await loadingTask.promise;

    const slides: SlideData[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items as TextItem[];
      const lines = extractLines(items);
      const rawText = lines.join("\n").trim();
      const title =
        lines.find((line) => line.trim().length > 0) || `Slide ${pageNumber}`;
      const textContent = rawText.slice(0, 6000);
      const textSummary = textContent.slice(0, 300);

      slides.push({
        index: pageNumber - 1,
        title,
        textContent,
        textSummary,
      });
    }

    await pdf.destroy();

    setSession(sessionId, {
      sessionId,
      slides,
      currentSlide: 0,
      createdAt: Date.now(),
      sourcePdfPath: inputPath,
    });

    const { assistantId, reason } = await createAssistantForSession({
      sessionId,
      slides,
      appUrl: appUrlFromRequest(request),
    });

    if (assistantId) {
      setAssistantId(sessionId, assistantId);
    }

    return NextResponse.json({
      sessionId,
      slideCount: slides.length,
      vapiAssistantId: assistantId,
      assistantNote: reason,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process PDF";
    if (/password|encrypted/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "This PDF appears to be password-protected. Please upload an unlocked PDF.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
